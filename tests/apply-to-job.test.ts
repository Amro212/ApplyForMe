import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../src/profile/defaultProfile.js";

const stagehandInit = vi.fn();
const pageGoto = vi.fn();
const pageWaitForLoadState = vi.fn();
const pageScreenshot = vi.fn();
const pageEvaluate = vi.fn();
const agentExecute = vi.fn();
const stagehandClose = vi.fn();
const stagehandConstructor = vi.fn();

vi.mock("@browserbasehq/stagehand", () => {
  class MockStagehand {
    context = {
      pages: () => [
        {
          goto: pageGoto,
          waitForLoadState: pageWaitForLoadState,
          screenshot: pageScreenshot,
          evaluate: pageEvaluate
        }
      ]
    };

    constructor(options: unknown) {
      stagehandConstructor(options);
    }

    async init() {
      return stagehandInit();
    }

    agent() {
      return {
        execute: agentExecute
      };
    }

    async close() {
      return stagehandClose();
    }
  }

  return { Stagehand: MockStagehand };
});

describe("applyToJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
    process.env.HEADLESS = "true";
    stagehandInit.mockResolvedValue(undefined);
    pageGoto.mockResolvedValue(undefined);
    pageWaitForLoadState.mockResolvedValue(undefined);
    pageScreenshot.mockResolvedValue(undefined);
    pageEvaluate.mockResolvedValue([
      "https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004"
    ]);
    stagehandClose.mockResolvedValue(undefined);
    agentExecute.mockResolvedValue({
      message: "Stopped before submit",
      output: {
        status: "completed",
        notes: "Stopped before submit",
        unknownFields: [],
        resumeUploadRequired: false
      }
    });
  });

  it("enables the experimental local configuration required for agent output schema", async () => {
    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_1",
      jobUrl: "https://example.com/jobs/1",
      company: "Acme",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        personal: {
          ...defaultProfile.personal,
          firstName: "Ada",
          lastName: "Lovelace",
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+1 555 0100"
        }
      }
    });

    expect(stagehandConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        env: "LOCAL",
        experimental: true,
        disableAPI: true,
        model: expect.objectContaining({
          modelName: "google/gemini-2.5-flash"
        })
      })
    );
    expect(result.status).toBe("completed");
  });

  it("returns a failed result when Stagehand agent execution fails before producing structured output", async () => {
    agentExecute.mockResolvedValueOnce({
      success: false,
      completed: false,
      actions: [],
      message: "Failed to execute task: bad model"
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_2",
      jobUrl: "https://example.com/jobs/2",
      company: "Beta",
      jobTitle: "Designer",
      profile: {
        ...defaultProfile,
        personal: {
          ...defaultProfile.personal,
          firstName: "Ada",
          lastName: "Lovelace",
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+1 555 0100"
        }
      }
    });

    expect(result.status).toBe("failed");
    expect(result.notes).toContain("Failed to execute task: bad model");
  });

  it("prefers an embedded greenhouse application iframe over the outer marketing page URL", async () => {
    const { resolveApplicationTargetUrl } = await import("../src/agent/applyToJob.js");

    const resolved = resolveApplicationTargetUrl("https://tipalti.com/company/jobs/?gh_jid=5837192004", [
      "",
      "https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004",
      "https://www.recaptcha.net/recaptcha/enterprise/anchor?x=1"
    ]);

    expect(resolved).toBe("https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004");
  });

  it("retries once with a focused fill instruction when the first agent attempt makes no field progress", async () => {
    agentExecute
      .mockResolvedValueOnce({
        success: false,
        completed: false,
        actions: [{ type: "act", action: "click the Apply button" }],
        message: "The Apply button was clicked, but no form fields were filled.",
        messages: [{ role: "user", content: "first attempt" }]
      })
      .mockResolvedValueOnce({
        success: true,
        completed: true,
        actions: [{ type: "act", action: "fill first name" }],
        message: "Filled visible fields",
        output: {
          status: "completed",
          notes: "Filled visible fields",
          unknownFields: [],
          resumeUploadRequired: false
        }
      });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_retry",
      jobUrl: "https://example.com/jobs/retry",
      company: "Retry Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        personal: {
          ...defaultProfile.personal,
          firstName: "Ada",
          lastName: "Lovelace",
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+1 555 0100"
        }
      }
    });

    expect(agentExecute).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("completed");
    expect(result.notes).toContain("Filled visible fields");
  });

  it("passes candidate profile data as execution variables so the agent can fill the form", async () => {
    const { applyToJob } = await import("../src/agent/applyToJob.js");

    await applyToJob({
      jobId: "job_variables",
      jobUrl: "https://example.com/jobs/variables",
      company: "Vars Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        personal: {
          ...defaultProfile.personal,
          firstName: "Amro",
          lastName: "Abedmoosa",
          fullName: "Amro Abedmoosa",
          email: "amromousa8@gmail.com",
          phone: "9054621004"
        }
      }
    });

    expect(agentExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          firstName: expect.objectContaining({ value: "Amro" }),
          fullName: expect.objectContaining({ value: "Amro Abedmoosa" }),
          email: expect.objectContaining({ value: "amromousa8@gmail.com" }),
          phone: expect.objectContaining({ value: "9054621004" })
        })
      })
    );
  });

  it("passes demographic and preference detail fields as direct execution variables", async () => {
    const { applyToJob } = await import("../src/agent/applyToJob.js");

    await applyToJob({
      jobId: "job_demographic_variables",
      jobUrl: "https://example.com/jobs/demographics",
      company: "Demo Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        preferences: {
          ...defaultProfile.preferences,
          willingToRelocate: true,
          relocationCities: ["Toronto", "Vancouver"]
        },
        demographic: {
          veteranStatus: "not a veteran",
          disabilityStatus: "no disability",
          ethnicity: "Arab",
          gender: "Male",
          pronouns: "he/him"
        }
      }
    });

    expect(agentExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          relocationCities: expect.objectContaining({ value: "Toronto, Vancouver" }),
          veteranStatus: expect.objectContaining({ value: "not a veteran" }),
          disabilityStatus: expect.objectContaining({ value: "no disability" }),
          ethnicity: expect.objectContaining({ value: "Arab" }),
          gender: expect.objectContaining({ value: "Male" }),
          pronouns: expect.objectContaining({ value: "he/him" })
        })
      })
    );
  });
});
