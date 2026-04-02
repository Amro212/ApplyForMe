import fs from "node:fs";
import path from "node:path";
import type { SavedJob } from "./types.js";
import { getJobsPath } from "../shared/paths.js";

export function loadJobs(): SavedJob[] {
  const jobsPath = getJobsPath();
  if (!fs.existsSync(jobsPath)) {
    return [];
  }

  const raw = fs.readFileSync(jobsPath, "utf-8");
  return JSON.parse(raw) as SavedJob[];
}

export function saveJobs(jobs: SavedJob[]): void {
  const jobsPath = getJobsPath();
  fs.mkdirSync(path.dirname(jobsPath), { recursive: true });
  fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2), "utf-8");
}
