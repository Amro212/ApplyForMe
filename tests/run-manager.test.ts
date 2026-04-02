import { describe, expect, it, vi } from "vitest";

describe("RunManager", () => {
  it("allows only one active run at a time and records lifecycle events", async () => {
    const { RunManager } = await import("../src/server/runManager.js");
    let finishRun: (() => void) | undefined;

    const events: string[] = [];
    const manager = new RunManager({
      runJob: async ({ onEvent, setStatus }) => {
        setStatus("running", "Working through application");
        onEvent("info", "Navigated to job page");
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return {
          timestamp: "2026-04-02T00:00:00.000Z",
          jobId: "job_1",
          jobUrl: "https://example.com/jobs/1",
          company: "Acme",
          jobTitle: "Engineer",
          status: "completed",
          unknownFields: [],
          resumeUploadRequired: false,
          notes: "Stopped before submit",
          durationSeconds: 5
        };
      },
      onEvent: (event) => {
        events.push(event.message);
      }
    });

    const firstRun = manager.startRun({
      id: "job_1",
      company: "Acme",
      jobTitle: "Engineer",
      jobUrl: "https://example.com/jobs/1",
      notes: "",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    });

    await expect(
      Promise.resolve().then(() =>
        manager.startRun({
          id: "job_2",
          company: "Beta",
          jobTitle: "Designer",
          jobUrl: "https://example.com/jobs/2",
          notes: "",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z"
        })
      )
    ).rejects.toThrow(/already in progress/i);

    finishRun?.();
    await firstRun;

    expect(manager.getActiveRun()).toBeNull();
    expect(manager.getHistory()).toHaveLength(1);
    expect(events).toContain("Navigated to job page");
  });
});
