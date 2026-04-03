import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string;

describe("logResult", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-job-logs-"));
    process.env.LOG_PATH = path.join(tempDir, "logs", "applications.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.LOG_PATH;
  });

  it("appends application results to the JSON log", async () => {
    const { logResult } = await import("../src/agent/resultLogger.js");

    logResult({
      timestamp: "2026-04-02T00:00:00.000Z",
      jobId: "job_1",
      jobUrl: "https://example.com/jobs/1",
      company: "Acme",
      jobTitle: "Frontend Engineer",
      status: "needs_review",
      unknownFields: ["Visa status"],
      resumeUploadRequired: true,
      notes: "Manual follow-up needed",
      durationSeconds: 12,
      finalAction: "reviewed",
      browserKeptOpen: true,
      reviewReason: "Manual follow-up needed",
      uploadedFiles: [],
      consistencyWarnings: []
    });

    logResult({
      timestamp: "2026-04-02T00:01:00.000Z",
      jobId: "job_2",
      jobUrl: "https://example.com/jobs/2",
      company: "Beta",
      jobTitle: "Backend Engineer",
      status: "completed",
      unknownFields: [],
      resumeUploadRequired: false,
      notes: "Stopped at submit",
      durationSeconds: 30,
      finalAction: "submitted",
      browserKeptOpen: false,
      uploadedFiles: [],
      consistencyWarnings: []
    });

    const parsed = JSON.parse(fs.readFileSync(process.env.LOG_PATH!, "utf-8")) as Array<{ jobId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((entry) => entry.jobId)).toEqual(["job_1", "job_2"]);
  });
});
