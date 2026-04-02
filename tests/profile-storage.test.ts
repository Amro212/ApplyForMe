import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string;

describe("profile and jobs storage", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-job-storage-"));
    process.env.PROFILE_PATH = path.join(tempDir, "profiles", "user.json");
    process.env.JOBS_PATH = path.join(tempDir, "profiles", "jobs.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PROFILE_PATH;
    delete process.env.JOBS_PATH;
  });

  it("returns the default profile when no saved profile exists", async () => {
    const { defaultProfile } = await import("../src/profile/defaultProfile.js");
    const { loadProfile, profileExists } = await import("../src/profile/storage.js");

    expect(profileExists()).toBe(false);
    expect(loadProfile()).toEqual(defaultProfile);
  });

  it("saves and reloads a user profile from disk", async () => {
    const { defaultProfile } = await import("../src/profile/defaultProfile.js");
    const { loadProfile, saveProfile } = await import("../src/profile/storage.js");

    const updated = {
      ...defaultProfile,
      personal: {
        ...defaultProfile.personal,
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+1 555 0100"
      }
    };

    saveProfile(updated);

    expect(loadProfile()).toEqual(updated);
    expect(fs.existsSync(process.env.PROFILE_PATH!)).toBe(true);
  });

  it("saves and reloads saved jobs", async () => {
    const { loadJobs, saveJobs } = await import("../src/jobs/storage.js");
    const jobs = [
      {
        id: "job_1",
        company: "Acme",
        jobTitle: "Frontend Engineer",
        jobUrl: "https://example.com/jobs/1",
        notes: "Priority",
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z"
      }
    ];

    saveJobs(jobs);

    expect(loadJobs()).toEqual(jobs);
    expect(fs.existsSync(process.env.JOBS_PATH!)).toBe(true);
  });
});
