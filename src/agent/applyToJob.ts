import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Stagehand } from "@browserbasehq/stagehand";
import type { AgentExecuteOptions, AgentResult, NonStreamingAgentInstance, Variables } from "@browserbasehq/stagehand";
import type { UserProfile } from "../profile/types.js";
import type { ApplicationResult, ApplicationStatus } from "../shared/types.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const agentOutputSchema = z.object({
  status: z.enum(["completed", "needs_review", "captcha_blocked", "resume_upload_required"]).default("needs_review"),
  notes: z.string().default("Run finished"),
  unknownFields: z.array(z.string()).default([]),
  resumeUploadRequired: z.boolean().default(false)
});
const STAGEHAND_MODEL_NAME = "google/gemini-2.5-flash";
const PRIMARY_EXECUTION_INSTRUCTION = `
Open the current application flow and fill in every visible section using the candidate profile.
Move top to bottom.
The candidate profile is available in the execution variables and the system prompt. Use those values directly while filling the form.
If the job application is embedded in an iframe or nested container, operate inside the actual application form rather than the surrounding marketing page.
If the page stalls after Next or Continue, wait 5 seconds, observe again, and retry once.
Stop before any final submit/apply/send action and mark the run completed.
Ignore invisible or background CAPTCHA widgets that are present by default.
Only stop for CAPTCHA when an interactive verification challenge or explicit robot check blocks further progress.
If a resume upload field appears, report it and continue without uploading.
Do not end the task only because a resume upload field exists.
Skip upload widgets whenever possible and keep filling every other field you can access.
Only stop with resume upload as the blocker when the page cannot proceed without the file.
If account creation is required, stop and mark the run for review.
Return unknown required fields using UNKNOWN_FIELD: [label] | type: [type] | required: true.
`.trim();
const RETRY_EXECUTION_INSTRUCTION = `
Continue from the current application page and fill visible non-upload fields now.
The candidate profile is available in the execution variables and the system prompt. Use those values directly now.
If the Apply button or similar CTA still needs to be clicked to reveal the form, click it first and then continue filling fields.
Do not end the task until at least one visible non-upload field has been filled, unless a real blocker appears.
Ignore invisible or background CAPTCHA widgets that are present by default.
Only stop for CAPTCHA when an interactive verification challenge or explicit robot check blocks further progress.
Skip resume upload widgets and continue filling every other field you can access.
If account creation is required or a required field cannot be identified from the profile, stop and report it for review.
Return unknown required fields using UNKNOWN_FIELD: [label] | type: [type] | required: true.
Stop before any final submit/apply/send action and mark the run completed.
`.trim();

function normalizeStatus(
  status: z.infer<typeof agentOutputSchema>["status"],
  resumeUploadRequired: boolean
): ApplicationStatus {
  if (status === "resume_upload_required" || resumeUploadRequired) {
    return "resume_upload_required";
  }

  return status;
}

export function resolveApplicationTargetUrl(jobUrl: string, iframeUrls: string[]): string {
  const candidate = iframeUrls.find((url) => /greenhouse\.io\/embed\/job_app/i.test(url));
  return candidate || jobUrl;
}

async function discoverIframeUrls(page: { evaluate: <T>(fn: () => T) => Promise<T> }, timeoutMs = 8000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;

  do {
    const iframeUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("iframe"))
        .map((frame) => (frame as HTMLIFrameElement).src)
        .filter(Boolean)
    );

    if (iframeUrls.length > 0) {
      return iframeUrls;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);

  return [];
}

function classifyAgentMessage(message: string): {
  status: ApplicationStatus;
  resumeUploadRequired: boolean;
  unknownFields: string[];
} {
  const lower = message.toLowerCase();
  const resumeUploadRequired = lower.includes("resume upload");
  const unknownFields = parseUnknownFields(message);

  if (lower.includes("captcha") || lower.includes("recaptcha")) {
    return {
      status: "captcha_blocked",
      resumeUploadRequired,
      unknownFields
    };
  }

  if (resumeUploadRequired) {
    return {
      status: "resume_upload_required",
      resumeUploadRequired: true,
      unknownFields
    };
  }

  if (unknownFields.length > 0 || lower.includes("account creation")) {
    return {
      status: "needs_review",
      resumeUploadRequired,
      unknownFields
    };
  }

  return {
    status: "failed",
    resumeUploadRequired,
    unknownFields
  };
}

export function parseUnknownFields(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => line.includes("UNKNOWN_FIELD:"))
    .map((line) => line.replace("UNKNOWN_FIELD:", "").trim());
}

function addVariable(variables: Variables, key: string, value: string | boolean | undefined, description: string): void {
  if (value === undefined || value === "") {
    return;
  }

  variables[key] = {
    value,
    description
  };
}

function buildExecutionVariables(profile: UserProfile): Variables {
  const variables: Variables = {};
  const educationSummary = profile.education
    .map(
      (entry) =>
        `${entry.degree} in ${entry.fieldOfStudy} at ${entry.university}, graduation ${entry.graduationDate}${
          entry.gpa ? `, GPA ${entry.gpa}/${entry.gpaScale ?? "4.0"}` : ""
        }`
    )
    .filter((entry) => entry.trim() !== "in at , graduation")
    .join("; ");
  const experienceSummary = profile.experience
    .map((entry) => `${entry.title} at ${entry.company} (${entry.startDate} - ${entry.endDate}) in ${entry.location}. ${entry.summary}`.trim())
    .join("; ");
  const skillsSummary = profile.skills
    .map((entry) => `${entry.name}${entry.yearsOfExperience ? ` (${entry.yearsOfExperience} years)` : ""}${entry.proficiencyLevel ? ` - ${entry.proficiencyLevel}` : ""}`)
    .join(", ");
  const referencesSummary = (profile.references ?? [])
    .map((entry) => `${entry.name}, ${entry.title} at ${entry.company}, relationship: ${entry.relationship}`)
    .join("; ");

  addVariable(variables, "firstName", profile.personal.firstName, "Candidate first name");
  addVariable(variables, "lastName", profile.personal.lastName, "Candidate last name");
  addVariable(variables, "fullName", profile.personal.fullName, "Candidate full legal name");
  addVariable(variables, "preferredName", profile.personal.preferredName, "Candidate preferred name");
  addVariable(variables, "email", profile.personal.email, "Candidate email address");
  addVariable(variables, "phone", profile.personal.phone, "Candidate phone number");
  addVariable(variables, "address", profile.personal.address, "Candidate street address");
  addVariable(variables, "city", profile.personal.city, "Candidate city");
  addVariable(variables, "province", profile.personal.province, "Candidate province or state");
  addVariable(variables, "country", profile.personal.country, "Candidate country");
  addVariable(variables, "postalCode", profile.personal.postalCode, "Candidate postal or zip code");
  addVariable(variables, "linkedin", profile.personal.linkedin, "Candidate LinkedIn URL");
  addVariable(variables, "github", profile.personal.github, "Candidate GitHub URL");
  addVariable(variables, "portfolio", profile.personal.portfolio, "Candidate portfolio or website URL");
  addVariable(variables, "jobTypes", profile.preferences.jobTypes.join(", "), "Preferred job types");
  addVariable(variables, "earliestStartDate", profile.preferences.earliestStartDate, "Earliest available start date");
  addVariable(variables, "willingToRelocate", profile.preferences.willingToRelocate ? "yes" : "no", "Whether the candidate is willing to relocate");
  addVariable(variables, "relocationCities", profile.preferences.relocationCities?.join(", "), "Cities the candidate is willing to relocate to");
  addVariable(variables, "remotePreference", profile.preferences.remotePreference, "Remote work preference");
  addVariable(variables, "salaryExpectation", profile.preferences.salaryExpectation, "Salary expectation");
  addVariable(variables, "salaryCurrency", profile.preferences.salaryCurrency, "Salary currency");
  addVariable(variables, "noticePeriod", profile.preferences.noticePeriod, "Notice period or availability");
  addVariable(variables, "educationSummary", educationSummary, "Education history summary");
  addVariable(variables, "experienceSummary", experienceSummary, "Work experience summary");
  addVariable(variables, "skillsSummary", skillsSummary, "Skills summary");
  addVariable(variables, "languages", profile.languages.map((entry) => `${entry.language}: ${entry.proficiency}`).join(", "), "Languages spoken by the candidate");
  addVariable(variables, "referencesSummary", referencesSummary, "References summary");
  addVariable(variables, "veteranStatus", profile.demographic?.veteranStatus, "Veteran status for self-identification questions");
  addVariable(variables, "disabilityStatus", profile.demographic?.disabilityStatus, "Disability status for self-identification questions");
  addVariable(variables, "ethnicity", profile.demographic?.ethnicity, "Ethnicity for self-identification questions");
  addVariable(variables, "gender", profile.demographic?.gender, "Gender for self-identification questions");
  addVariable(variables, "pronouns", profile.demographic?.pronouns, "Pronouns for self-identification questions");
  addVariable(variables, "coverLetterStyle", profile.settings.coverLetterStyle, "Preferred cover letter style");
  addVariable(variables, "defaultAnswerForUnknown", profile.settings.defaultAnswerForUnknown, "Configured default for unknown application questions");
  addVariable(variables, "stopBeforeSubmit", profile.settings.stopBeforeSubmit, "Whether the automation must stop before final submission");
  addVariable(variables, "screenshotOnComplete", profile.settings.screenshotOnComplete, "Whether the run captures a completion screenshot");
  addVariable(
    variables,
    "workAuthorizationSummary",
    profile.workAuthorization
      .map(
        (entry) =>
          `${entry.country}: ${entry.authorized ? "authorized" : "not authorized"}, ${
            entry.requiresSponsorship ? "requires sponsorship" : "no sponsorship required"
          }`
      )
      .join("; "),
    "Work authorization and sponsorship summary"
  );
  addVariable(variables, "resumePath", profile.settings.resumePath, "Local resume path if the run needs to reference it");
  addVariable(variables, "profileJson", JSON.stringify(profile), "Full candidate profile as JSON");

  return variables;
}

function shouldRetryAfterNoFieldProgress(result: AgentResult): boolean {
  const message = (result.message || "").toLowerCase();
  return (
    result.success === false &&
    result.completed === false &&
    (message.includes("no form fields were filled") ||
      message.includes("no fields were filled") ||
      (message.includes("apply button") && message.includes("filled")))
  );
}

async function runAgentWithRetry(
  agent: NonStreamingAgentInstance,
  variables: Variables,
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void
): Promise<AgentResult> {
  const firstAttempt: AgentExecuteOptions = {
    instruction: PRIMARY_EXECUTION_INSTRUCTION,
    maxSteps: 20,
    output: agentOutputSchema,
    variables
  };
  const firstResult = await agent.execute(firstAttempt);

  if (!shouldRetryAfterNoFieldProgress(firstResult)) {
    return firstResult;
  }

  onEvent?.("warn", "Agent reached the form without filling fields; retrying with a tighter fill instruction");

  const retryAttempt: AgentExecuteOptions = {
    instruction: RETRY_EXECUTION_INSTRUCTION,
    maxSteps: 20,
    output: agentOutputSchema,
    messages: firstResult.messages,
    variables
  };

  return agent.execute(retryAttempt);
}

export async function applyToJob(args: {
  jobId: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  profile: UserProfile;
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void;
  setStatus?: (status: ApplicationStatus | "starting" | "running", summary: string) => void;
}): Promise<ApplicationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const startedAt = Date.now();
  let screenshotPath: string | undefined;
  let stagehand: Stagehand | undefined;

  try {
    args.setStatus?.("starting", "Launching browser session");

    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      experimental: true,
      disableAPI: true,
      model: {
        modelName: STAGEHAND_MODEL_NAME,
        apiKey
      },
      localBrowserLaunchOptions: {
        headless: process.env.HEADLESS === "true",
        acceptDownloads: true
      },
      logger: (line) => {
        args.onEvent?.(line.level === 0 ? "warn" : "info", line.message);
      }
    });

    await stagehand.init();
    const page = stagehand.context.pages()[0];
    args.onEvent?.("info", `Navigating to ${args.jobUrl}`);
    args.setStatus?.("running", "Navigating to application page");
    await page.goto(args.jobUrl);
    await page.waitForLoadState("domcontentloaded");

    const iframeUrls = await discoverIframeUrls(page);
    const targetUrl = resolveApplicationTargetUrl(args.jobUrl, iframeUrls);
    if (targetUrl !== args.jobUrl) {
      args.onEvent?.("info", `Navigating directly to embedded application: ${targetUrl}`);
      await page.goto(targetUrl);
      await page.waitForLoadState("domcontentloaded");
    }

    const agent = stagehand.agent({
      systemPrompt: buildSystemPrompt(args.profile),
      model: {
        modelName: STAGEHAND_MODEL_NAME,
        apiKey
      }
    });
    const executionVariables = buildExecutionVariables(args.profile);

    const result = await runAgentWithRetry(agent, executionVariables, args.onEvent);

    if (result.success === false || result.completed === false) {
      const classified = classifyAgentMessage(result.message || "Stagehand agent execution failed");
      args.onEvent?.("warn", result.message || "Stagehand agent execution failed");
      args.setStatus?.(classified.status, result.message || "Stagehand agent execution failed");

      if (args.profile.settings.screenshotOnComplete) {
        const screenshotDir = path.resolve("./logs/screenshots");
        fs.mkdirSync(screenshotDir, { recursive: true });
        screenshotPath = path.join(screenshotDir, `${args.jobId}-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        args.onEvent?.("info", `Saved screenshot to ${screenshotPath}`);
      }

      return {
        timestamp: new Date().toISOString(),
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status: classified.status,
        unknownFields: classified.unknownFields,
        resumeUploadRequired: classified.resumeUploadRequired,
        notes: result.message || "Stagehand agent execution failed",
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        screenshotPath
      };
    }

    const structured = agentOutputSchema.parse(result.output ?? {});
    const resultMessage = result.message || "";
    const unknownFields = structured.unknownFields.length
      ? structured.unknownFields
      : parseUnknownFields(resultMessage);
    const resumeUploadRequired = structured.resumeUploadRequired || resultMessage.includes("RESUME_UPLOAD_REQUIRED");
    const status = normalizeStatus(structured.status, resumeUploadRequired);

    args.onEvent?.("success", structured.notes);
    args.setStatus?.(status, structured.notes);

    if (args.profile.settings.screenshotOnComplete) {
      const screenshotDir = path.resolve("./logs/screenshots");
      fs.mkdirSync(screenshotDir, { recursive: true });
      screenshotPath = path.join(screenshotDir, `${args.jobId}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      args.onEvent?.("info", `Saved screenshot to ${screenshotPath}`);
    }

    return {
      timestamp: new Date().toISOString(),
      jobId: args.jobId,
      jobUrl: args.jobUrl,
      company: args.company,
      jobTitle: args.jobTitle,
      status,
      unknownFields,
      resumeUploadRequired,
      notes: structured.notes || resultMessage || "Run finished",
      durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      screenshotPath
    };
  } catch (error) {
    args.onEvent?.("error", String(error));
    args.setStatus?.("failed", "Run failed");
    return {
      timestamp: new Date().toISOString(),
      jobId: args.jobId,
      jobUrl: args.jobUrl,
      company: args.company,
      jobTitle: args.jobTitle,
      status: "failed",
      unknownFields: [],
      resumeUploadRequired: false,
      notes: `Error: ${String(error)}`,
      durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      screenshotPath
    };
  } finally {
    await stagehand?.close().catch(() => undefined);
  }
}
