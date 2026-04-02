import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

let tempDir: string;

async function startTestServer() {
  const { createApp } = await import("../src/server/app.js");
  const app = await createApp({
    enableViteMiddleware: false,
    runJob: async ({ job, onEvent, setStatus }) => {
      setStatus("running", "Working");
      onEvent("info", "Visited application page");
      return {
        timestamp: new Date().toISOString(),
        jobId: job.id,
        jobUrl: job.jobUrl,
        company: job.company,
        jobTitle: job.jobTitle,
        status: "completed",
        unknownFields: [],
        resumeUploadRequired: false,
        notes: "Stopped before submit",
        durationSeconds: 1
      };
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

describe("server API", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-job-api-"));
    process.env.PROFILE_PATH = path.join(tempDir, "profiles", "user.json");
    process.env.JOBS_PATH = path.join(tempDir, "profiles", "jobs.json");
    process.env.LOG_PATH = path.join(tempDir, "logs", "applications.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PROFILE_PATH;
    delete process.env.JOBS_PATH;
    delete process.env.LOG_PATH;
  });

  it("serves profile CRUD, saved jobs CRUD, and run endpoints", async () => {
    const { server, baseUrl } = await startTestServer();

    try {
      const profileResponse = await fetch(`${baseUrl}/api/profile`);
      expect(profileResponse.status).toBe(200);
      const profile = (await profileResponse.json()) as { personal: { country: string } };
      expect(profile.personal.country).toBe("Canada");

      const saveProfileResponse = await fetch(`${baseUrl}/api/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...profile,
          personal: {
            ...profile.personal,
            firstName: "Ada",
            lastName: "Lovelace",
            fullName: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+1 555 0100"
          }
        })
      });
      expect(saveProfileResponse.status).toBe(200);

      const createJobResponse = await fetch(`${baseUrl}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: "Acme",
          jobTitle: "Frontend Engineer",
          jobUrl: "https://example.com/jobs/1",
          notes: "Priority"
        })
      });
      expect(createJobResponse.status).toBe(201);
      const job = (await createJobResponse.json()) as { id: string; company: string };
      expect(job.company).toBe("Acme");

      const listJobsResponse = await fetch(`${baseUrl}/api/jobs`);
      const jobs = (await listJobsResponse.json()) as Array<{ id: string }>;
      expect(jobs).toHaveLength(1);

      const updateJobResponse = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: "Acme",
          jobTitle: "Senior Frontend Engineer",
          jobUrl: "https://example.com/jobs/1",
          notes: "Updated"
        })
      });
      expect(updateJobResponse.status).toBe(200);

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id })
      });
      expect(runResponse.status).toBe(202);

      const historyResponse = await fetch(`${baseUrl}/api/runs`);
      const history = (await historyResponse.json()) as Array<{ jobId: string; status: string }>;
      expect(history[0]).toMatchObject({ jobId: job.id, status: "completed" });

      const activeRunResponse = await fetch(`${baseUrl}/api/runs/active`);
      expect(activeRunResponse.status).toBe(200);
      expect(await activeRunResponse.json()).toBeNull();

      const deleteResponse = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
        method: "DELETE"
      });
      expect(deleteResponse.status).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("round-trips the full profile payload through the profile API without dropping non-personal fields", async () => {
    const { server, baseUrl } = await startTestServer();

    try {
      const richProfile = {
        personal: {
          firstName: "Amro",
          lastName: "Abedmoosa",
          fullName: "Amro Abedmoosa",
          email: "amromousa8@gmail.com",
          phone: "9054621004",
          address: "176 Ruhl Drive",
          city: "Milton",
          province: "Ontario",
          country: "Canada",
          postalCode: "L9T8A4",
          linkedin: "linkedin.com/in/amro-abedmoosa/",
          github: "github.com/amro212",
          portfolio: "itsamro.me",
          preferredName: "Amro"
        },
        workAuthorization: [
          { country: "Canada", authorized: true, requiresSponsorship: false },
          { country: "United States", authorized: false, requiresSponsorship: true }
        ],
        preferences: {
          jobTypes: ["full-time", "contract"],
          earliestStartDate: "2026-04-15",
          willingToRelocate: true,
          relocationCities: ["Toronto", "Vancouver"],
          remotePreference: "hybrid",
          salaryExpectation: "120000",
          salaryCurrency: "CAD",
          noticePeriod: "2 weeks"
        },
        education: [
          {
            degree: "BSc",
            fieldOfStudy: "Computer Science",
            university: "TMU",
            graduationDate: "2026-06-01",
            gpa: "3.8",
            gpaScale: "4.0"
          }
        ],
        experience: [
          {
            title: "Frontend Developer Intern",
            company: "Acme",
            startDate: "2025-05-01",
            endDate: "2025-08-31",
            location: "Toronto",
            summary: "Built frontend features.",
            responsibilities: ["Implemented React UI", "Wrote tests"]
          }
        ],
        skills: [
          {
            name: "React",
            yearsOfExperience: 3,
            proficiencyLevel: "advanced"
          }
        ],
        languages: [{ language: "English", proficiency: "fluent" }],
        references: [
          {
            name: "Jane Smith",
            title: "Manager",
            company: "Acme",
            relationship: "Former manager",
            email: "jane@example.com",
            phone: "555-0101"
          }
        ],
        demographic: {
          veteranStatus: "not a veteran",
          disabilityStatus: "no disability",
          ethnicity: "Arab",
          gender: "Male",
          pronouns: "he/him"
        },
        settings: {
          coverLetterStyle: "technical",
          resumePath: "./resumes/custom.pdf",
          defaultAnswerForUnknown: "prefer not to say",
          stopBeforeSubmit: false,
          screenshotOnComplete: false
        }
      };

      const saveProfileResponse = await fetch(`${baseUrl}/api/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(richProfile)
      });
      expect(saveProfileResponse.status).toBe(200);

      const reloadedResponse = await fetch(`${baseUrl}/api/profile`);
      expect(reloadedResponse.status).toBe(200);
      expect(await reloadedResponse.json()).toEqual(richProfile);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
