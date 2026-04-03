import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../src/profile/defaultProfile.js";

const stagehandInit = vi.fn();
const pageGoto = vi.fn();
const pageWaitForLoadState = vi.fn();
const pageWaitForTimeout = vi.fn();
const pageScreenshot = vi.fn();
const pageEvaluate = vi.fn();
const pageUrl = vi.fn();
const pageTitle = vi.fn();
const locatorSetInputFiles = vi.fn();
const locatorInputValue = vi.fn();
const locatorCount = vi.fn();
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
          waitForTimeout: pageWaitForTimeout,
          screenshot: pageScreenshot,
          evaluate: pageEvaluate,
          url: pageUrl,
          title: pageTitle,
          locator: () => ({
            count: locatorCount,
            nth: () => ({
              setInputFiles: locatorSetInputFiles,
              inputValue: locatorInputValue
            })
          })
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
    delete process.env.AGENT_EXECUTION_TIMEOUT_MS;
    stagehandInit.mockResolvedValue(undefined);
    pageGoto.mockResolvedValue(undefined);
    pageWaitForLoadState.mockResolvedValue(undefined);
    pageWaitForTimeout.mockResolvedValue(undefined);
    pageScreenshot.mockResolvedValue(undefined);
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return ["https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004"];
      }
      if (mode === "file-inputs") {
        return [];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 4, completedValueCount: 2 };
      }
      return [];
    });
    pageUrl.mockReturnValue("https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004");
    pageTitle.mockResolvedValue("Application");
    locatorCount.mockResolvedValue(0);
    locatorSetInputFiles.mockResolvedValue(undefined);
    locatorInputValue.mockResolvedValue("C:\\docs\\resume.pdf");
    stagehandClose.mockResolvedValue(undefined);
    agentExecute.mockResolvedValue({
      success: true,
      completed: true,
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
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        },
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

  it("prefers an embedded lever application iframe over the outer marketing page URL", async () => {
    const { resolveApplicationTargetUrl } = await import("../src/agent/applyToJob.js");

    const resolved = resolveApplicationTargetUrl("https://example.com/careers/senior-engineer", [
      "https://www.google.com/recaptcha/api2/anchor?x=1",
      "https://jobs.lever.co/acme/12345678-1234-1234-1234-123456789012/apply"
    ]);

    expect(resolved).toBe("https://jobs.lever.co/acme/12345678-1234-1234-1234-123456789012/apply");
  });

  it("prefers an embedded ashby application iframe over the outer marketing page URL", async () => {
    const { resolveApplicationTargetUrl } = await import("../src/agent/applyToJob.js");

    const resolved = resolveApplicationTargetUrl("https://example.com/jobs/staff-engineer", [
      "https://cdn.example.com/widget/careers.html",
      "https://jobs.ashbyhq.com/acme/7f2d1c15-9ef6-4ce9-a9b8-a6b6b8f02f8f/application"
    ]);

    expect(resolved).toBe("https://jobs.ashbyhq.com/acme/7f2d1c15-9ef6-4ce9-a9b8-a6b6b8f02f8f/application");
  });

  it("waits for delayed iframe discovery and then navigates directly to the embedded application", async () => {
    const embeddedUrl = "https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004";
    let iframeReads = 0;
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        iframeReads += 1;
        return iframeReads < 4 ? [] : [embeddedUrl];
      }
      if (mode === "file-inputs") {
        return [];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 4, completedValueCount: 2 };
      }
      return [];
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    await applyToJob({
      jobId: "job_iframe_delay",
      jobUrl: "https://tipalti.com/company/jobs/?gh_jid=5837192004&gh_src=my.greenhouse.search",
      company: "Tipalti",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        }
      }
    });

    expect(pageGoto).toHaveBeenNthCalledWith(1, "https://tipalti.com/company/jobs/?gh_jid=5837192004&gh_src=my.greenhouse.search");
    expect(pageGoto).toHaveBeenNthCalledWith(2, embeddedUrl);
    expect(pageWaitForTimeout).toHaveBeenCalled();
  });

  it("retries once with a focused fill instruction when the first agent attempt makes no field progress", async () => {
    let progressReads = 0;
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return ["https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004"];
      }
      if (mode === "file-inputs") {
        return [];
      }
      if (mode === "form-progress") {
        progressReads += 1;
        return progressReads < 3
          ? { nonFileControlCount: 4, completedValueCount: 1 }
          : { nonFileControlCount: 4, completedValueCount: 3 };
      }
      return [];
    });

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
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        },
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

  it("does not force a no-progress failure when the form is embedded in an iframe context", async () => {
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return ["https://job-boards.greenhouse.io/embed/job_app?for=tipaltisolutions&token=5837192004"];
      }
      if (mode === "file-inputs") {
        return [];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 0, completedValueCount: 0, iframeCount: 1 };
      }
      return [];
    });

    agentExecute.mockResolvedValueOnce({
      success: true,
      completed: true,
      actions: [{ type: "act", action: "filled fields" }],
      message: "Filled visible fields in the embedded application form",
      output: {
        status: "completed",
        notes: "Filled visible fields",
        unknownFields: [],
        resumeUploadRequired: false
      }
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_iframe_progress",
      jobUrl: "https://tipalti.com/company/jobs/?gh_jid=5837192004&gh_src=my.greenhouse.search",
      company: "Tipalti",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        }
      }
    });

    expect(result.status).toBe("completed");
    expect(result.notes).toContain("Filled visible fields");
    expect(result.consistencyWarnings).toEqual([]);
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

  it("uploads matched file inputs with Playwright locators instead of reporting resume upload required", async () => {
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return [];
      }
      if (mode === "file-inputs") {
        return [
          {
            index: 0,
            label: "Resume / CV",
            required: true,
            descriptors: ["resume", "curriculum vitae"]
          }
        ];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 3, completedValueCount: 2 };
      }
      return [];
    });
    locatorCount.mockResolvedValue(1);
    locatorInputValue.mockResolvedValue("C:\\docs\\resume.pdf");

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_upload",
      jobUrl: "https://example.com/jobs/upload",
      company: "Upload Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit",
          keepBrowserOpenPolicy: "never",
          resumePath: "C:\\docs\\resume.pdf",
          coverLetterPath: "",
          attachmentMappings: []
        }
      }
    });

    expect(locatorSetInputFiles).toHaveBeenCalledWith("C:\\docs\\resume.pdf");
    expect(result.resumeUploadRequired).toBe(false);
    expect(result.uploadedFiles).toEqual([
      expect.objectContaining({ classification: "resume", outcome: "uploaded" })
    ]);
  });

  it("treats upload as successful when widget shows the filename even after file input state is cleared", async () => {
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return [];
      }
      if (mode === "file-inputs") {
        return [
          {
            index: 0,
            label: "Resume / CV",
            required: true,
            descriptors: ["resume", "curriculum vitae"]
          }
        ];
      }
      if (mode === "inspect-upload") {
        return {
          selectedCount: 0,
          selectedName: "",
          uploadErrorText: "Cannot read properties of undefined (reading 'uploadFile')",
          hasFilenameText: true,
          matchedFileName: "my_resume.pdf",
          uploadContainerPreview: "Resume/CV My_resume.pdf"
        };
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 3, completedValueCount: 2 };
      }
      return [];
    });
    locatorCount.mockResolvedValue(1);

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_upload_widget_filename",
      jobUrl: "https://example.com/jobs/upload-widget",
      company: "Upload Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit",
          keepBrowserOpenPolicy: "never",
          resumePath: "C:\\docs\\My_resume.pdf",
          coverLetterPath: "",
          attachmentMappings: []
        }
      }
    });

    expect(locatorSetInputFiles).toHaveBeenCalledWith("C:\\docs\\My_resume.pdf");
    expect(result.status).toBe("completed");
    expect(result.uploadedFiles).toEqual([
      expect.objectContaining({ classification: "resume", outcome: "uploaded" })
    ]);
    expect(result.consistencyWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Upload widget displayed an error")])
    );
  });

  it("runs file attachment inspection before the first Stagehand fill execution", async () => {
    const callOrder: string[] = [];
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return [];
      }
      if (mode === "file-inputs") {
        callOrder.push("file-inputs");
        return [];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 2, completedValueCount: 1 };
      }
      return [];
    });
    agentExecute.mockImplementationOnce(async () => {
      callOrder.push("fill-execute");
      return {
        success: true,
        completed: true,
        message: "Stopped before submit",
        output: {
          status: "completed",
          notes: "Stopped before submit",
          unknownFields: [],
          resumeUploadRequired: false
        }
      };
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    await applyToJob({
      jobId: "job_order",
      jobUrl: "https://example.com/jobs/order",
      company: "Order Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        }
      }
    });

    expect(callOrder.indexOf("file-inputs")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("fill-execute")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("file-inputs")).toBeLessThan(callOrder.indexOf("fill-execute"));
  });

  it("continues into the upload phase when the fill phase reports resume upload is required", async () => {
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return [];
      }
      if (mode === "file-inputs") {
        return [
          {
            index: 0,
            label: "Resume / CV",
            required: true,
            descriptors: ["resume", "curriculum vitae"]
          }
        ];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 3, completedValueCount: 2 };
      }
      return [];
    });
    locatorCount.mockResolvedValue(1);
    locatorInputValue.mockResolvedValue("C:\\docs\\resume.pdf");
    agentExecute.mockResolvedValueOnce({
      success: false,
      completed: false,
      message: "RESUME_UPLOAD_REQUIRED: Resume / CV"
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_resume_blocker",
      jobUrl: "https://example.com/jobs/upload-required",
      company: "Upload Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit",
          keepBrowserOpenPolicy: "never",
          resumePath: "C:\\docs\\resume.pdf",
          coverLetterPath: "",
          attachmentMappings: []
        }
      }
    });

    expect(locatorSetInputFiles).toHaveBeenCalledWith("C:\\docs\\resume.pdf");
    expect(result.uploadedFiles).toEqual([
      expect.objectContaining({ classification: "resume", outcome: "uploaded" })
    ]);
    expect(result.resumeUploadRequired).toBe(false);
  });

  it("fails cleanly when the agent execute call hangs after transport issues", async () => {
    process.env.AGENT_EXECUTION_TIMEOUT_MS = "25";
    agentExecute.mockImplementationOnce(() => new Promise(() => undefined));

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_timeout",
      jobUrl: "https://example.com/jobs/timeout",
      company: "Timeout Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "review_before_submit"
        }
      }
    });

    expect(result.status).toBe("failed");
    expect(result.notes).toContain("timed out");
  });

  it("keeps the browser open for review when the policy requires it", async () => {
    pageEvaluate.mockImplementation(async (_fn, arg) => {
      const mode = (arg as { mode?: string } | undefined)?.mode;
      if (mode === "iframe-urls") {
        return [];
      }
      if (mode === "file-inputs") {
        return [
          {
            index: 0,
            label: "Resume / CV",
            required: true,
            descriptors: ["resume", "curriculum vitae"]
          }
        ];
      }
      if (mode === "form-progress") {
        return { nonFileControlCount: 2, completedValueCount: 2 };
      }
      return [];
    });

    const { applyToJob } = await import("../src/agent/applyToJob.js");

    const result = await applyToJob({
      jobId: "job_review",
      jobUrl: "https://example.com/jobs/review",
      company: "Review Co",
      jobTitle: "Engineer",
      profile: {
        ...defaultProfile,
        settings: {
          ...defaultProfile.settings,
          submissionMode: "auto_submit",
          keepBrowserOpenPolicy: "failures_and_review",
          resumePath: "",
          coverLetterPath: "",
          attachmentMappings: []
        }
      }
    });

    expect(result.status).toBe("needs_review");
    expect(result.browserKeptOpen).toBe(true);
    expect(stagehandClose).not.toHaveBeenCalled();
  });
});
