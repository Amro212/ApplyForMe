import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { ZodError } from "zod";
import type { SavedJob } from "../jobs/types.js";
import { loadJobs, saveJobs } from "../jobs/storage.js";
import { defaultProfile } from "../profile/defaultProfile.js";
import { loadProfile, saveProfile } from "../profile/storage.js";
import { logResult, readLoggedResults } from "../agent/resultLogger.js";
import { applyToJob } from "../agent/applyToJob.js";
import { createSavedJobSchema, runRequestSchema, updateSavedJobSchema, userProfileSchema } from "../shared/schemas.js";
import { RunManager } from "./runManager.js";
import type { ApplicationResult } from "../shared/types.js";

const projectRoot = process.cwd();

interface CreateAppOptions {
  enableViteMiddleware?: boolean;
  runJob?: Parameters<RunManager["startRun"]>[0] extends never
    ? never
    : (args: {
        job: SavedJob;
        onEvent: (level: "info" | "warn" | "error" | "success", message: string) => void;
        setStatus: (status: "starting" | "running" | ApplicationResult["status"], summary: string) => void;
      }) => Promise<ApplicationResult>;
}

function buildDefaultRunJob(): NonNullable<CreateAppOptions["runJob"]> {
  return async ({ job, onEvent, setStatus }) => {
    const result = await applyToJob({
      jobId: job.id,
      jobUrl: job.jobUrl,
      company: job.company,
      jobTitle: job.jobTitle,
      profile: loadProfile(),
      onEvent,
      setStatus
    });

    logResult(result);
    return result;
  };
}

function sendZodError(res: express.Response, error: ZodError): void {
  res.status(400).json({
    error: "Validation failed",
    issues: error.issues
  });
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const runManager = new RunManager({
    runJob: options.runJob ?? buildDefaultRunJob()
  });

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/profile", (_req, res) => {
    res.json(loadProfile());
  });

  app.post("/api/profile", (req, res) => {
    try {
      const profile = userProfileSchema.parse(req.body);
      saveProfile(profile);
      res.json(profile);
    } catch (error) {
      if (error instanceof ZodError) {
        sendZodError(res, error);
        return;
      }
      throw error;
    }
  });

  app.get("/api/jobs", (_req, res) => {
    res.json(loadJobs());
  });

  app.post("/api/jobs", (req, res) => {
    try {
      const payload = createSavedJobSchema.parse(req.body);
      const now = new Date().toISOString();
      const created: SavedJob = {
        ...payload,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      saveJobs([...loadJobs(), created]);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof ZodError) {
        sendZodError(res, error);
        return;
      }
      throw error;
    }
  });

  app.put("/api/jobs/:jobId", (req, res) => {
    try {
      const payload = updateSavedJobSchema.parse(req.body);
      const jobs = loadJobs();
      const index = jobs.findIndex((job) => job.id === req.params.jobId);
      if (index === -1) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      const updated: SavedJob = {
        ...jobs[index],
        ...payload,
        updatedAt: new Date().toISOString()
      };
      jobs[index] = updated;
      saveJobs(jobs);
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        sendZodError(res, error);
        return;
      }
      throw error;
    }
  });

  app.delete("/api/jobs/:jobId", (req, res) => {
    const jobs = loadJobs();
    const filtered = jobs.filter((job) => job.id !== req.params.jobId);
    saveJobs(filtered);
    res.status(204).end();
  });

  app.get("/api/runs", (_req, res) => {
    const inMemory = runManager.getHistory();
    res.json(inMemory.length > 0 ? inMemory : readLoggedResults().slice().reverse());
  });

  app.get("/api/runs/active", (_req, res) => {
    res.json(runManager.getActiveRun());
  });

  app.get("/api/runs/stream", (req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = runManager.subscribe((state) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    });

    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });

  app.post("/api/runs", async (req, res) => {
    try {
      const { jobId } = runRequestSchema.parse(req.body);
      const profile = loadProfile();
      if (!profile.personal.email || !profile.personal.firstName || !profile.personal.lastName) {
        res.status(400).json({ error: "Profile must be completed before starting a run" });
        return;
      }

      const job = loadJobs().find((entry) => entry.id === jobId);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      if (runManager.getActiveRun()) {
        res.status(409).json({ error: "A run is already in progress" });
        return;
      }

      void runManager.startRun(job).then((result) => {
        if (!options.runJob) {
          return;
        }
        logResult(result);
      });

      res.status(202).json({ accepted: true });
    } catch (error) {
      if (error instanceof ZodError) {
        sendZodError(res, error);
        return;
      }
      throw error;
    }
  });

  if (options.enableViteMiddleware !== false) {
    const distIndex = path.resolve(projectRoot, "dist/client/index.html");
    if (process.env.NODE_ENV === "production" && fs.existsSync(distIndex)) {
      app.use(express.static(path.resolve(projectRoot, "dist/client")));
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(distIndex);
      });
    } else {
      const { createServer } = await import("vite");
      const vite = await createServer({
        appType: "custom",
        server: { middlewareMode: true },
        configFile: path.resolve(projectRoot, "vite.config.ts")
      });

      app.use(vite.middlewares);
      app.get(/^(?!\/api).*/, async (req, res, next) => {
        try {
          const htmlPath = path.resolve(projectRoot, "ui/index.html");
          const template = await fs.promises.readFile(htmlPath, "utf-8");
          const html = await vite.transformIndexHtml(req.originalUrl, template);
          res.status(200).setHeader("content-type", "text/html").end(html);
        } catch (error) {
          vite.ssrFixStacktrace(error as Error);
          next(error);
        }
      });
    }
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  });

  return app;
}
