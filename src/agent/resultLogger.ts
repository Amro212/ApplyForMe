import fs from "node:fs";
import path from "node:path";
import type { ApplicationResult } from "../shared/types.js";
import { getLogPath } from "../shared/paths.js";

export function readLoggedResults(): ApplicationResult[] {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(logPath, "utf-8")) as ApplicationResult[];
}

export function logResult(result: ApplicationResult): void {
  const logPath = getLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const existing = readLoggedResults();
  existing.push(result);
  fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), "utf-8");
}
