import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Stagehand } from "@browserbasehq/stagehand";
import type { AgentExecuteOptions, AgentResult, NonStreamingAgentInstance, Variables } from "@browserbasehq/stagehand";
import type { UserProfile } from "../profile/types.js";
import type { ActiveRunState, ApplicationResult, ApplicationStatus, FinalAction, UploadedFileResult } from "../shared/types.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const agentOutputSchema = z.object({
  status: z.enum(["completed", "needs_review", "captcha_blocked", "resume_upload_required"]).default("needs_review"),
  notes: z.string().default("Run finished"),
  unknownFields: z.array(z.string()).default([]),
  resumeUploadRequired: z.boolean().default(false)
});
const STAGEHAND_MODEL_NAME = "google/gemini-2.5-flash";
const EMBEDDED_APPLICATION_URL_PATTERNS: RegExp[] = [
  /greenhouse\.io\/(embed\/job_app|job-boards\/)/i,
  /https?:\/\/jobs\.lever\.co\//i,
  /https?:\/\/jobs\.ashbyhq\.com\//i
];
const FILL_PHASE_INSTRUCTION = `
Open the current application flow and fill in every visible non-file field using the candidate profile.
Work top to bottom through the real application form, including embedded application iframes when needed.
Do not upload any files.
Do not click any final submit/apply/send action during this phase.
If the page stalls after Next or Continue, wait 5 seconds, observe again, and retry once.
If account creation is required, stop and mark the run for review.
Ignore invisible or background CAPTCHA widgets. Only stop for a real interactive CAPTCHA challenge.
Return unknown required fields using UNKNOWN_FIELD: [label] | type: [type] | required: true.
`.trim();
const FILL_RETRY_INSTRUCTION = `
Continue from the current application page and fill visible non-file fields now.
If the form is hidden behind an Apply button, click it first and keep filling.
Do not stop until you have either filled visible non-file fields or hit a real blocker.
Do not upload files.
Do not click any final submit/apply/send action during this phase.
Return unknown required fields using UNKNOWN_FIELD: [label] | type: [type] | required: true.
`.trim();
const SUBMIT_PHASE_INSTRUCTION = `
Review the current application page and submit only if the form is complete and a final Submit/Apply/Send Application action is visible.
Click the final submit action exactly once.
Wait for an observable completion state such as a confirmation page, thank-you page, or success message.
Do not create an account, do not upload files, and do not proceed if another blocker is present.
If there is no final submit control or the form still needs review, mark the run for review instead of guessing.
`.trim();

interface AutomationLocator {
  setInputFiles: (files: string | string[]) => Promise<void>;
  inputValue: () => Promise<string>;
}

interface AutomationPage {
  goto: (url: string) => Promise<unknown>;
  waitForLoadState: (state: "domcontentloaded" | "load" | "networkidle") => Promise<void>;
  waitForTimeout?: (ms: number) => Promise<void>;
  screenshot: (options: { path: string; fullPage: boolean }) => Promise<unknown>;
  evaluate: <T, Arg = unknown>(pageFunction: ((arg: Arg) => T | Promise<T>) | string, arg?: Arg) => Promise<T>;
  locator: (selector: string) => {
    count: () => Promise<number>;
    nth: (index: number) => AutomationLocator;
  };
  url?: () => string;
  title?: () => Promise<string>;
}

interface FileInputDescriptor {
  index: number;
  label: string;
  required: boolean;
  descriptors: string[];
  domId?: string;
  domName?: string;
}

interface PlannedUpload {
  index: number;
  label: string;
  classification: UploadedFileResult["classification"];
  filePath: string;
  required: boolean;
  domId?: string;
  domName?: string;
}

interface UploadPlan {
  uploads: PlannedUpload[];
  blockers: string[];
}

interface FormProgressSnapshot {
  nonFileControlCount: number;
  completedValueCount: number;
  iframeCount: number;
  url: string;
  title: string;
}

type UploadDebugLog = (step: string, details?: Record<string, unknown>) => void;

function createUploadDebugLogger(jobId: string): { logPath: string; log: UploadDebugLog } {
  const logDir = path.resolve("./logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `upload-debug-${jobId}-${Date.now()}.log`);

  const log: UploadDebugLog = (step, details = {}) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      step,
      details
    });
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  };

  log("debug_logger_initialized", { jobId, logPath });
  return { logPath, log };
}

function getAgentExecutionTimeoutMs(): number {
  const parsed = Number(process.env.AGENT_EXECUTION_TIMEOUT_MS ?? "90000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90000;
}

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
  const candidate = iframeUrls.find((url) => {
    const normalized = url.trim();
    return EMBEDDED_APPLICATION_URL_PATTERNS.some((pattern) => pattern.test(normalized));
  });
  return candidate || jobUrl;
}

function shouldUseExtendedIframeDiscovery(jobUrl: string): boolean {
  const normalized = jobUrl.toLowerCase();
  return (
    normalized.includes("gh_jid=") ||
    normalized.includes("greenhouse.io") ||
    normalized.includes("lever.co") ||
    normalized.includes("ashbyhq.com")
  );
}

async function discoverIframeUrls(page: AutomationPage, timeoutMs = 8000, pollMs = 250): Promise<string[]> {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollMs));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const iframeUrls = await page.evaluate(
      (payload: { mode: "iframe-urls" }) => {
        void payload;
        return Array.from(document.querySelectorAll("iframe"))
          .map((frame) => (frame as HTMLIFrameElement).src)
          .filter(Boolean);
      },
      { mode: "iframe-urls" }
    );

    if (iframeUrls.length > 0) {
      return iframeUrls;
    }

    if (attempt < maxAttempts - 1) {
      await (page.waitForTimeout?.(pollMs) ?? new Promise((resolve) => setTimeout(resolve, pollMs)));
    }
  }

  return [];
}

function classifyAgentMessage(message: string): {
  status: ApplicationStatus;
  resumeUploadRequired: boolean;
  unknownFields: string[];
} {
  const lower = message.toLowerCase();
  const resumeUploadRequired =
    lower.includes("resume upload") ||
    lower.includes("resume_upload_required") ||
    lower.includes("upload required");
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
  addVariable(variables, "submissionMode", profile.settings.submissionMode, "Whether to stop for review or auto submit");
  addVariable(variables, "keepBrowserOpenPolicy", profile.settings.keepBrowserOpenPolicy, "Whether to keep the browser open after the run");
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
  addVariable(variables, "coverLetterPath", profile.settings.coverLetterPath, "Local cover letter path if a cover letter upload appears");
  addVariable(
    variables,
    "attachmentMappingSummary",
    profile.settings.attachmentMappings.map((entry) => `${entry.labelContains}: ${entry.filePath}`).join("; "),
    "Attachment mappings for arbitrary file upload fields"
  );
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

function agentClaimsAction(result: AgentResult): boolean {
  if (Array.isArray((result as { actions?: unknown[] }).actions) && ((result as { actions?: unknown[] }).actions?.length ?? 0) > 0) {
    return true;
  }

  return /\b(filled|clicked|submitted|selected|typed)\b/i.test(result.message || "");
}

function isKnownBlockerMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("captcha") || lower.includes("account creation") || lower.includes("unknown_field:");
}

async function captureFormProgress(page: AutomationPage): Promise<FormProgressSnapshot> {
  const counts = await page.evaluate(
    (payload: { mode: "form-progress" }) => {
      void payload;
      const controls = Array.from(document.querySelectorAll("input, textarea, select")).filter((element) => {
        const input = element as HTMLInputElement;
        return !input.disabled && (input.type || "").toLowerCase() !== "file";
      });
      const completedValueCount = controls.filter((element) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (input instanceof HTMLInputElement && ["checkbox", "radio"].includes(input.type.toLowerCase())) {
          return input.checked;
        }

        return String(input.value ?? "").trim().length > 0;
      }).length;

      return {
        nonFileControlCount: controls.length,
        completedValueCount,
        iframeCount: document.querySelectorAll("iframe").length
      };
    },
    { mode: "form-progress" }
  );

  return {
    ...counts,
    iframeCount: counts.iframeCount ?? 0,
    url: page.url?.() ?? "",
    title: (await page.title?.()) ?? ""
  };
}

function hasMeaningfulProgress(before: FormProgressSnapshot, after: FormProgressSnapshot): boolean {
  return (
    after.completedValueCount > before.completedValueCount ||
    after.url !== before.url ||
    after.title !== before.title
  );
}

function isProgressSignalReliable(before: FormProgressSnapshot, after: FormProgressSnapshot): boolean {
  return before.iframeCount === 0 && after.iframeCount === 0;
}

async function runAgentWithRetry(
  agent: NonStreamingAgentInstance,
  page: AutomationPage,
  variables: Variables,
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void
): Promise<{ result: AgentResult; progressVerified: boolean; progressCheckReliable: boolean; consistencyWarnings: string[] }> {
  const beforeProgress = await captureFormProgress(page);
  let result = await executeAgent(agent, {
    instruction: FILL_PHASE_INSTRUCTION,
    maxSteps: 20,
    output: agentOutputSchema,
    variables
  });
  let afterProgress = await captureFormProgress(page);
  let progressVerified = hasMeaningfulProgress(beforeProgress, afterProgress);
  let progressCheckReliable = isProgressSignalReliable(beforeProgress, afterProgress);
  const consistencyWarnings: string[] = [];

  if (
    shouldRetryAfterNoFieldProgress(result) ||
    (progressCheckReliable && agentClaimsAction(result) && !progressVerified && !isKnownBlockerMessage(result.message || ""))
  ) {
    onEvent?.("warn", "Agent did not produce observable form progress; retrying the fill phase once");
    result = await executeAgent(agent, {
      instruction: FILL_RETRY_INSTRUCTION,
      maxSteps: 20,
      output: agentOutputSchema,
      messages: result.messages,
      variables
    });
    afterProgress = await captureFormProgress(page);
    progressVerified = hasMeaningfulProgress(beforeProgress, afterProgress);
    progressCheckReliable = isProgressSignalReliable(beforeProgress, afterProgress);
  }

  if (
    progressCheckReliable &&
    agentClaimsAction(result) &&
    !progressVerified &&
    Math.max(beforeProgress.nonFileControlCount, afterProgress.nonFileControlCount) > 0
  ) {
    consistencyWarnings.push("Fill phase reported actions without observable page or field progress");
  }

  return {
    result,
    progressVerified,
    progressCheckReliable,
    consistencyWarnings
  };
}

function descriptorText(descriptor: FileInputDescriptor): string {
  return [descriptor.label, ...descriptor.descriptors].join(" ").toLowerCase();
}

function isResumeField(descriptor: FileInputDescriptor): boolean {
  const text = descriptorText(descriptor);
  return text.includes("resume") || text.includes("cv") || text.includes("curriculum vitae");
}

function isCoverLetterField(descriptor: FileInputDescriptor): boolean {
  return descriptorText(descriptor).includes("cover letter");
}

export function planFileUploads(
  settings: Pick<UserProfile["settings"], "resumePath" | "coverLetterPath" | "attachmentMappings">,
  descriptors: FileInputDescriptor[]
): UploadPlan {
  const uploads: PlannedUpload[] = [];
  const blockers: string[] = [];

  for (const descriptor of descriptors) {
    const matches: PlannedUpload[] = [];

    if (settings.resumePath && isResumeField(descriptor)) {
      matches.push({
        index: descriptor.index,
        label: descriptor.label,
        classification: "resume",
        filePath: settings.resumePath,
        required: descriptor.required,
        domId: descriptor.domId,
        domName: descriptor.domName
      });
    }

    if (settings.coverLetterPath && isCoverLetterField(descriptor)) {
      matches.push({
        index: descriptor.index,
        label: descriptor.label,
        classification: "cover_letter",
        filePath: settings.coverLetterPath,
        required: descriptor.required,
        domId: descriptor.domId,
        domName: descriptor.domName
      });
    }

    for (const mapping of settings.attachmentMappings) {
      const needle = mapping.labelContains.trim().toLowerCase();
      if (needle.length === 0) {
        continue;
      }

      if (descriptorText(descriptor).includes(needle)) {
        matches.push({
          index: descriptor.index,
          label: descriptor.label,
          classification: "attachment",
          filePath: mapping.filePath,
          required: descriptor.required,
          domId: descriptor.domId,
          domName: descriptor.domName
        });
      }
    }

    if (matches.length === 1) {
      uploads.push(matches[0]);
      continue;
    }

    if (matches.length > 1) {
      blockers.push(`Ambiguous file match for ${descriptor.label}`);
      continue;
    }

    if (descriptor.required) {
      blockers.push(`Required file field has no matching file: ${descriptor.label}`);
    }
  }

  return { uploads, blockers };
}

async function listFileInputs(page: AutomationPage): Promise<FileInputDescriptor[]> {
  return page.evaluate(
    (payload: { mode: "file-inputs" }) => {
      void payload;
      try {
        const fileInputs: FileInputDescriptor[] = [];
        const inputs = document.querySelectorAll("input[type='file']");
        
        inputs.forEach((element, index) => {
          try {
            const input = element as HTMLInputElement;
            const label = input.getAttribute("aria-label") || input.name || input.id || `File field ${index + 1}`;
            const ariaDescribedBy = input.getAttribute("aria-describedby") || "";
            const accept = input.getAttribute("accept") || "";
            const required = input.required === true;

            const descriptors = [
              label,
              ariaDescribedBy,
              accept
            ]
              .filter((s) => s.trim().length > 0)
              .join(" ")
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((s) => s.trim().length > 0);

            fileInputs.push({
              index,
              label,
              required,
              descriptors,
              domId: input.id || undefined,
              domName: input.name || undefined
            });
          } catch {
            // Skip elements that fail to process
          }
        });

        return fileInputs;
      } catch {
        return [];
      }
    },
    { mode: "file-inputs" }
  );
}

async function inspectUploadResult(
  page: AutomationPage,
  index: number,
  expectedFileName?: string,
  domId?: string,
  domName?: string
): Promise<{
  selectedCount: number;
  selectedName: string;
  uploadErrorText: string | null;
  hasFilenameText: boolean;
  matchedFileName: string | null;
  uploadContainerPreview: string;
}> {
  const inspected = await page
    .evaluate(
      (payload: {
        mode: "inspect-upload";
        index: number;
        expectedFileName?: string;
        domId?: string;
        domName?: string;
      }) => {
        const inputs = Array.from(document.querySelectorAll("input[type='file']"));
        const input =
          inputs.find((candidate) => payload.domId && (candidate as HTMLInputElement).id === payload.domId) ??
          inputs.find((candidate) => payload.domName && (candidate as HTMLInputElement).name === payload.domName) ??
          (inputs[payload.index] as HTMLInputElement | undefined);
        const documentTextLower = (document.body?.textContent || "").toLowerCase();
        const normalizedExpectedName = (payload.expectedFileName || "").trim().toLowerCase();

        if (!input) {
          const hasDocumentFilenameText =
            normalizedExpectedName.length > 0 && documentTextLower.includes(normalizedExpectedName);
          return {
            selectedCount: 0,
            selectedName: "",
            uploadErrorText: null,
            hasFilenameText: hasDocumentFilenameText,
            matchedFileName: hasDocumentFilenameText ? normalizedExpectedName : null,
            uploadContainerPreview: ""
          };
        }

        const selectedCount = input.files?.length ?? 0;
        const selectedName = selectedCount > 0 ? input.files?.[0]?.name ?? "" : "";
        const uploadContainer = input.closest(".file-upload__wrapper") ?? input.parentElement ?? document.body;
        const uploadContainerText = (uploadContainer.textContent || "").trim();
        const uploadContainerTextLower = uploadContainerText.toLowerCase();
        const uploadErrorText = Array.from(uploadContainer.querySelectorAll("*"))
          .map((element) => (element.textContent || "").trim())
          .find((text) => /cannot read properties of undefined.*uploadfile/i.test(text)) ?? null;
        const candidateNames = [selectedName, payload.expectedFileName]
          .map((name) => (name || "").trim().toLowerCase())
          .filter((name) => name.length > 0);
        const matchedFileName =
          candidateNames.find((name) => uploadContainerTextLower.includes(name) || documentTextLower.includes(name)) ?? null;
        const hasFilenameText = matchedFileName !== null;

        return {
          selectedCount,
          selectedName,
          uploadErrorText,
          hasFilenameText,
          matchedFileName,
          uploadContainerPreview: uploadContainerText.slice(0, 400)
        };
      },
      { mode: "inspect-upload", index, expectedFileName, domId, domName }
    )
    .catch(() => null);

  if (!inspected || typeof inspected !== "object" || typeof (inspected as { selectedCount?: unknown }).selectedCount !== "number") {
    // If DOM inspection is unavailable, do not block a successful setInputFiles call.
    return {
      selectedCount: 1,
      selectedName: "",
      uploadErrorText: null,
      hasFilenameText: true,
      matchedFileName: expectedFileName ?? null,
      uploadContainerPreview: "inspection unavailable"
    };
  }

  return inspected as {
    selectedCount: number;
    selectedName: string;
    uploadErrorText: string | null;
    hasFilenameText: boolean;
    matchedFileName: string | null;
    uploadContainerPreview: string;
  };
}

async function dispatchFileSelectionEvents(
  page: AutomationPage,
  index: number,
  domId?: string,
  domName?: string
): Promise<{ dispatched: boolean; error: string | null }> {
  const result = await page
    .evaluate(
      (payload: { mode: "dispatch-file-events"; index: number; domId?: string; domName?: string }) => {
        try {
          const inputs = Array.from(document.querySelectorAll("input[type='file']"));
          const input =
            inputs.find((candidate) => payload.domId && (candidate as HTMLInputElement).id === payload.domId) ??
            inputs.find((candidate) => payload.domName && (candidate as HTMLInputElement).name === payload.domName) ??
            (inputs[payload.index] as HTMLInputElement | undefined);
          if (!input) {
            return { dispatched: false, error: "input not found" };
          }

          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return { dispatched: true, error: null };
        } catch (error) {
          return { dispatched: false, error: String(error) };
        }
      },
      { mode: "dispatch-file-events", index, domId, domName }
    )
    .catch((error) => ({ dispatched: false, error: String(error) }));

  if (!result || typeof result !== "object") {
    return { dispatched: false, error: "unknown dispatch result" };
  }

  return {
    dispatched: Boolean((result as { dispatched?: unknown }).dispatched),
    error: typeof (result as { error?: unknown }).error === "string" ? ((result as { error?: string }).error ?? null) : null
  };
}

async function applyUploads(
  page: AutomationPage,
  plan: UploadPlan,
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void,
  debugLog?: UploadDebugLog
): Promise<{ uploadedFiles: UploadedFileResult[]; blockers: string[]; consistencyWarnings: string[] }> {
  const uploadedFiles: UploadedFileResult[] = [];
  const blockers = [...plan.blockers];
  const consistencyWarnings: string[] = [];
  const fileInputs = page.locator("input[type='file']");
  const count = await fileInputs.count();
  debugLog?.("apply_uploads_started", {
    plannedUploads: plan.uploads.map((upload) => ({
      index: upload.index,
      label: upload.label,
      classification: upload.classification,
      filePath: upload.filePath,
      required: upload.required,
      domId: upload.domId,
      domName: upload.domName
    })),
    planBlockers: plan.blockers,
    domFileInputCount: count
  });

  for (const upload of plan.uploads) {
    debugLog?.("upload_attempt_started", {
      index: upload.index,
      label: upload.label,
      classification: upload.classification,
      filePath: upload.filePath,
      required: upload.required,
      domId: upload.domId,
      domName: upload.domName,
      domFileInputCount: count
    });

    let locator: AutomationLocator | null = null;
    if (upload.domId) {
      const escapedId = upload.domId.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
      const byId = page.locator(`input[type='file'][id=\"${escapedId}\"]`);
      const byIdCount = await byId.count();
      if (byIdCount > 0) {
        locator = byId.nth(0);
      }
    }

    if (!locator && upload.domName) {
      const escapedName = upload.domName.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
      const byName = page.locator(`input[type='file'][name=\"${escapedName}\"]`);
      const byNameCount = await byName.count();
      if (byNameCount > 0) {
        locator = byName.nth(0);
      }
    }

    if (!locator) {
      if (upload.index >= count) {
        blockers.push(`File field disappeared before upload: ${upload.label}`);
        debugLog?.("upload_blocked_input_disappeared", {
          index: upload.index,
          label: upload.label,
          domId: upload.domId,
          domName: upload.domName,
          domFileInputCount: count
        });
        uploadedFiles.push({
          fieldLabel: upload.label,
          classification: upload.classification,
          filePath: upload.filePath,
          required: upload.required,
          outcome: "blocked"
        });
        continue;
      }

      locator = fileInputs.nth(upload.index);
    }

    try {
      await locator.setInputFiles(upload.filePath);
      debugLog?.("upload_set_input_files_succeeded", {
        index: upload.index,
        label: upload.label,
        filePath: upload.filePath
      });
    } catch (error) {
      blockers.push(`Upload failed for ${upload.label}: ${String(error)}`);
      debugLog?.("upload_set_input_files_failed", {
        index: upload.index,
        label: upload.label,
        filePath: upload.filePath,
        error: String(error)
      });
      uploadedFiles.push({
        fieldLabel: upload.label,
        classification: upload.classification,
        filePath: upload.filePath,
        required: upload.required,
        outcome: "blocked"
      });
      continue;
    }

    const expectedFileName = path.basename(upload.filePath).toLowerCase();
    const uploadInspectionImmediate = await inspectUploadResult(
      page,
      upload.index,
      expectedFileName,
      upload.domId,
      upload.domName
    );
    await (page.waitForTimeout?.(1200) ?? new Promise((resolve) => setTimeout(resolve, 1200)));
    let uploadInspection = await inspectUploadResult(page, upload.index, expectedFileName, upload.domId, upload.domName);
    let dispatchResult: { dispatched: boolean; error: string | null } | null = null;

    if (uploadInspection.selectedCount <= 0 && !uploadInspection.hasFilenameText) {
      dispatchResult = await dispatchFileSelectionEvents(page, upload.index, upload.domId, upload.domName);
      debugLog?.("upload_events_dispatched_as_fallback", {
        index: upload.index,
        label: upload.label,
        dispatched: dispatchResult.dispatched,
        error: dispatchResult.error
      });

      await (page.waitForTimeout?.(800) ?? new Promise((resolve) => setTimeout(resolve, 800)));
      uploadInspection = await inspectUploadResult(page, upload.index, expectedFileName, upload.domId, upload.domName);
    }

    debugLog?.("upload_post_inspection", {
      index: upload.index,
      label: upload.label,
      immediate: uploadInspectionImmediate,
      delayed: uploadInspection,
      fallbackDispatch: dispatchResult
    });

    if (uploadInspection.uploadErrorText && uploadInspection.selectedCount <= 0 && !uploadInspection.hasFilenameText) {
      blockers.push(`Upload widget reported an error for ${upload.label}: ${uploadInspection.uploadErrorText}`);
      consistencyWarnings.push(`Upload widget error detected for ${upload.label}`);
      debugLog?.("upload_blocked_widget_error", {
        index: upload.index,
        label: upload.label,
        uploadErrorText: uploadInspection.uploadErrorText
      });
      uploadedFiles.push({
        fieldLabel: upload.label,
        classification: upload.classification,
        filePath: upload.filePath,
        required: upload.required,
        outcome: "blocked"
      });
      continue;
    }

    if (uploadInspection.uploadErrorText) {
      consistencyWarnings.push(
        `Upload widget displayed an error for ${upload.label} but filename evidence was present`
      );
      debugLog?.("upload_widget_error_non_blocking", {
        index: upload.index,
        label: upload.label,
        uploadErrorText: uploadInspection.uploadErrorText,
        selectedCount: uploadInspection.selectedCount,
        hasFilenameText: uploadInspection.hasFilenameText,
        matchedFileName: uploadInspection.matchedFileName
      });
    }

    if (uploadInspection.selectedCount <= 0 && !uploadInspection.hasFilenameText) {
      blockers.push(`File was not selected after upload attempt for ${upload.label}`);
      consistencyWarnings.push(`Upload phase found no selected file for ${upload.label}`);
      debugLog?.("upload_blocked_no_selected_file", {
        index: upload.index,
        label: upload.label
      });
      uploadedFiles.push({
        fieldLabel: upload.label,
        classification: upload.classification,
        filePath: upload.filePath,
        required: upload.required,
        outcome: "blocked"
      });
      continue;
    }

    if (!uploadInspection.hasFilenameText) {
      consistencyWarnings.push(
        `Upload phase selected a file input for ${upload.label}, but the UI did not render a filename`
      );
      debugLog?.("upload_filename_not_rendered_non_blocking", {
        index: upload.index,
        label: upload.label,
        selectedName: uploadInspection.selectedName,
        uploadContainerPreview: uploadInspection.uploadContainerPreview
      });
    }

    onEvent?.(
      "info",
      `Uploaded ${upload.classification} to ${upload.label}${uploadInspection.selectedName ? ` (${uploadInspection.selectedName})` : ""}`
    );
    debugLog?.("upload_marked_success", {
      index: upload.index,
      label: upload.label,
      classification: upload.classification,
      selectedName: uploadInspection.selectedName
    });
    uploadedFiles.push({
      fieldLabel: upload.label,
      classification: upload.classification,
      filePath: upload.filePath,
      required: upload.required,
      outcome: "uploaded"
    });
  }

  return {
    uploadedFiles,
    blockers,
    consistencyWarnings
  };
}

async function runSubmitPhase(
  agent: NonStreamingAgentInstance,
  page: AutomationPage,
  variables: Variables,
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void
): Promise<{ result: AgentResult; progressVerified: boolean; progressCheckReliable: boolean; consistencyWarnings: string[] }> {
  const beforeProgress = await captureFormProgress(page);
  let result = await executeAgent(agent, {
    instruction: SUBMIT_PHASE_INSTRUCTION,
    maxSteps: 8,
    output: agentOutputSchema,
    variables
  });
  let afterProgress = await captureFormProgress(page);
  let progressVerified = hasMeaningfulProgress(beforeProgress, afterProgress);
  let progressCheckReliable = isProgressSignalReliable(beforeProgress, afterProgress);
  const consistencyWarnings: string[] = [];

  if (progressCheckReliable && agentClaimsAction(result) && !progressVerified && !isKnownBlockerMessage(result.message || "")) {
    onEvent?.("warn", "Submit phase reported no observable effect; retrying once");
    result = await executeAgent(agent, {
      instruction: SUBMIT_PHASE_INSTRUCTION,
      maxSteps: 8,
      output: agentOutputSchema,
      messages: result.messages,
      variables
    });
    afterProgress = await captureFormProgress(page);
    progressVerified = hasMeaningfulProgress(beforeProgress, afterProgress);
    progressCheckReliable = isProgressSignalReliable(beforeProgress, afterProgress);
  }

  if (progressCheckReliable && agentClaimsAction(result) && !progressVerified) {
    consistencyWarnings.push("Submit phase reported actions without an observable completion change");
  }

  return {
    result,
    progressVerified,
    progressCheckReliable,
    consistencyWarnings
  };
}

async function executeAgent(agent: NonStreamingAgentInstance, options: AgentExecuteOptions): Promise<AgentResult> {
  const timeoutMs = getAgentExecutionTimeoutMs();
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<AgentResult>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`Agent execute timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      agent.execute({
        ...options,
        signal: controller.signal,
        toolTimeout: Math.min(timeoutMs, 45000)
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function shouldKeepBrowserOpen(
  policy: UserProfile["settings"]["keepBrowserOpenPolicy"],
  status: ApplicationStatus,
  finalAction: FinalAction
): boolean {
  if (policy === "always") {
    return true;
  }

  if (policy === "failures_and_review") {
    return status === "failed" || status === "needs_review" || finalAction === "reviewed";
  }

  return false;
}

function buildResult(args: {
  startedAt: number;
  jobId: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  status: ApplicationStatus;
  unknownFields?: string[];
  resumeUploadRequired?: boolean;
  notes: string;
  screenshotPath?: string;
  finalAction: FinalAction;
  browserKeptOpen: boolean;
  reviewReason?: string;
  uploadedFiles?: UploadedFileResult[];
  consistencyWarnings?: string[];
}): ApplicationResult {
  return {
    timestamp: new Date().toISOString(),
    jobId: args.jobId,
    jobUrl: args.jobUrl,
    company: args.company,
    jobTitle: args.jobTitle,
    status: args.status,
    unknownFields: args.unknownFields ?? [],
    resumeUploadRequired: args.resumeUploadRequired ?? false,
    notes: args.notes,
    durationSeconds: Math.max(1, Math.round((Date.now() - args.startedAt) / 1000)),
    screenshotPath: args.screenshotPath,
    finalAction: args.finalAction,
    browserKeptOpen: args.browserKeptOpen,
    reviewReason: args.reviewReason,
    uploadedFiles: args.uploadedFiles ?? [],
    consistencyWarnings: args.consistencyWarnings ?? []
  };
}

function appendUploadedFiles(target: UploadedFileResult[], incoming: UploadedFileResult[]): void {
  for (const entry of incoming) {
    const alreadyPresent = target.some(
      (current) =>
        current.fieldLabel === entry.fieldLabel &&
        current.classification === entry.classification &&
        current.filePath === entry.filePath &&
        current.required === entry.required &&
        current.outcome === entry.outcome
    );

    if (!alreadyPresent) {
      target.push(entry);
    }
  }
}

export async function applyToJob(args: {
  jobId: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  profile: UserProfile;
  onEvent?: (level: "info" | "warn" | "error" | "success", message: string) => void;
  setStatus?: (status: ApplicationStatus | "starting" | "running", summary: string) => void;
  updateRunState?: (patch: Partial<Pick<ActiveRunState, "phase" | "browserKeptOpen" | "reviewReason" | "consistencyWarnings" | "finalAction">>) => void;
}): Promise<ApplicationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const startedAt = Date.now();
  const uploadDebug = createUploadDebugLogger(args.jobId);
  const debugLog = uploadDebug.log;
  let screenshotPath: string | undefined;
  let stagehand: Stagehand | undefined;
  let browserKeptOpen = false;

  try {
    debugLog("run_started", {
      jobUrl: args.jobUrl,
      resumePath: args.profile.settings.resumePath,
      coverLetterPath: args.profile.settings.coverLetterPath,
      attachmentMappings: args.profile.settings.attachmentMappings
    });
    args.setStatus?.("starting", "Launching browser session");
    args.updateRunState?.({
      phase: "starting",
      browserKeptOpen: false,
      consistencyWarnings: [],
      finalAction: "none"
    });

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
    debugLog("stagehand_initialized");
    const page = stagehand.context.pages()[0] as unknown as AutomationPage;
    const takeScreenshot = async () => {
      const screenshotDir = path.resolve("./logs/screenshots");
      fs.mkdirSync(screenshotDir, { recursive: true });
      screenshotPath = path.join(screenshotDir, `${args.jobId}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      args.onEvent?.("info", `Saved screenshot to ${screenshotPath}`);
    };

    args.updateRunState?.({ phase: "navigating" });
    args.onEvent?.("info", `Navigating to ${args.jobUrl}`);
    args.setStatus?.("running", "Navigating to application page");
    await page.goto(args.jobUrl);
    await page.waitForLoadState("domcontentloaded");
    debugLog("navigated_to_job_url", { url: args.jobUrl });

    const iframeDiscoveryTimeoutMs = shouldUseExtendedIframeDiscovery(args.jobUrl) ? 8000 : 2000;
    const iframeUrls = await discoverIframeUrls(page, iframeDiscoveryTimeoutMs);
    debugLog("iframe_discovery_complete", { iframeUrls, timeoutMs: iframeDiscoveryTimeoutMs });
    const targetUrl = resolveApplicationTargetUrl(args.jobUrl, iframeUrls);
    if (targetUrl !== args.jobUrl) {
      args.onEvent?.("info", `Navigating directly to embedded application: ${targetUrl}`);
      await page.goto(targetUrl);
      await page.waitForLoadState("domcontentloaded");
      debugLog("navigated_to_embedded_application", { targetUrl });
    }

    const agent = stagehand.agent({
      systemPrompt: buildSystemPrompt(args.profile),
      model: {
        modelName: STAGEHAND_MODEL_NAME,
        apiKey
      }
    });
    const executionVariables = buildExecutionVariables(args.profile);
    const uploadedFiles: UploadedFileResult[] = [];

    args.updateRunState?.({ phase: "uploading" });
    args.onEvent?.("info", "Inspecting file inputs for direct uploads before fill phase");
    let fileInputDescriptors: FileInputDescriptor[] = [];
    try {
      fileInputDescriptors = await listFileInputs(page);
      debugLog("file_inputs_discovered", {
        descriptors: fileInputDescriptors
      });
    } catch (error) {
      args.onEvent?.("warn", `Failed to inspect file inputs: ${String(error)}`);
      fileInputDescriptors = [];
      debugLog("file_input_discovery_failed", { error: String(error) });
    }
    const initialUploadPlan = planFileUploads(args.profile.settings, fileInputDescriptors);
    debugLog("initial_upload_plan", {
      uploads: initialUploadPlan.uploads,
      blockers: initialUploadPlan.blockers
    });
    const initialUploadPhase = await applyUploads(page, initialUploadPlan, args.onEvent, debugLog);
    debugLog("initial_upload_phase_result", {
      uploadedFiles: initialUploadPhase.uploadedFiles,
      blockers: initialUploadPhase.blockers,
      consistencyWarnings: initialUploadPhase.consistencyWarnings
    });
    appendUploadedFiles(uploadedFiles, initialUploadPhase.uploadedFiles);
    let combinedWarnings = [...initialUploadPhase.consistencyWarnings];
    if (combinedWarnings.length > 0) {
      args.updateRunState?.({ consistencyWarnings: combinedWarnings });
    }

    if (initialUploadPhase.blockers.length > 0) {
      const reviewReason = initialUploadPhase.blockers.join("; ");
      browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, "needs_review", "reviewed");
      args.setStatus?.("needs_review", reviewReason);
      args.updateRunState?.({
        phase: "finished",
        browserKeptOpen,
        reviewReason,
        finalAction: "reviewed",
        consistencyWarnings: combinedWarnings
      });

      if (args.profile.settings.screenshotOnComplete) {
        await takeScreenshot();
      }

      return buildResult({
        startedAt,
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status: "needs_review",
        resumeUploadRequired: /resume|cv/i.test(reviewReason),
        notes: reviewReason,
        screenshotPath,
        finalAction: "reviewed",
        browserKeptOpen,
        reviewReason,
        uploadedFiles,
        consistencyWarnings: combinedWarnings
      });
    }

    args.updateRunState?.({ phase: "filling" });
    const fillPhase = await runAgentWithRetry(agent, page, executionVariables, args.onEvent);
    combinedWarnings = [...combinedWarnings, ...fillPhase.consistencyWarnings];
    if (combinedWarnings.length > 0) {
      args.updateRunState?.({ consistencyWarnings: combinedWarnings });
    }

    const proceedToUploadAfterFillBlocker =
      fillPhase.result.success === false &&
      fillPhase.result.completed === false &&
      classifyAgentMessage(fillPhase.result.message || "").status === "resume_upload_required";

    if ((fillPhase.result.success === false || fillPhase.result.completed === false) && !proceedToUploadAfterFillBlocker) {
      const classified = classifyAgentMessage(fillPhase.result.message || "Stagehand agent execution failed");
      const finalAction: FinalAction = classified.status === "needs_review" ? "reviewed" : "none";
      browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, classified.status, finalAction);
      args.setStatus?.(classified.status, fillPhase.result.message || "Stagehand agent execution failed");
      args.updateRunState?.({ phase: "finished", browserKeptOpen, finalAction });

      if (args.profile.settings.screenshotOnComplete) {
        await takeScreenshot();
      }

      return buildResult({
        startedAt,
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status: classified.status,
        unknownFields: classified.unknownFields,
        resumeUploadRequired: classified.resumeUploadRequired,
        notes: fillPhase.result.message || "Stagehand agent execution failed",
        screenshotPath,
        finalAction,
        browserKeptOpen,
        uploadedFiles,
        consistencyWarnings: combinedWarnings
      });
    }

    const fillOutput: z.infer<typeof agentOutputSchema> =
      fillPhase.result.success === false || fillPhase.result.completed === false
        ? {
            status: "completed",
            notes: fillPhase.result.message || "Uploads need to be handled before finishing the application",
            unknownFields: parseUnknownFields(fillPhase.result.message || ""),
            resumeUploadRequired: true
          }
        : agentOutputSchema.parse(fillPhase.result.output ?? {});
    const unknownFields = fillOutput.unknownFields.length
      ? fillOutput.unknownFields
      : parseUnknownFields(fillPhase.result.message || "");

    if (!fillPhase.progressVerified && fillPhase.progressCheckReliable && agentClaimsAction(fillPhase.result)) {
      browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, "failed", "none");
      args.setStatus?.("failed", "Fill phase had no observable effect");
      args.updateRunState?.({
        phase: "finished",
        browserKeptOpen,
        consistencyWarnings: fillPhase.consistencyWarnings,
        finalAction: "none"
      });

      if (args.profile.settings.screenshotOnComplete) {
        await takeScreenshot();
      }

      return buildResult({
        startedAt,
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status: "failed",
        unknownFields,
        notes: "Fill phase reported actions without observable page progress",
        screenshotPath,
        finalAction: "none",
        browserKeptOpen,
        uploadedFiles,
        consistencyWarnings: combinedWarnings
      });
    }

    if (proceedToUploadAfterFillBlocker) {
      args.updateRunState?.({ phase: "uploading" });
      args.onEvent?.("info", "Fill phase hit a file-upload blocker; attempting direct file uploads");
      let uploadFileInputDescriptors: FileInputDescriptor[] = [];
      try {
        uploadFileInputDescriptors = await listFileInputs(page);
        debugLog("file_inputs_rediscovered_after_fill", {
          descriptors: uploadFileInputDescriptors
        });
      } catch (error) {
        args.onEvent?.("warn", `Failed to re-inspect file inputs after fill phase: ${String(error)}`);
        uploadFileInputDescriptors = [];
        debugLog("file_input_rediscovery_failed_after_fill", { error: String(error) });
      }
      const uploadPlan = planFileUploads(args.profile.settings, uploadFileInputDescriptors);
      debugLog("followup_upload_plan", {
        uploads: uploadPlan.uploads,
        blockers: uploadPlan.blockers
      });
      const uploadPhase = await applyUploads(page, uploadPlan, args.onEvent, debugLog);
      debugLog("followup_upload_phase_result", {
        uploadedFiles: uploadPhase.uploadedFiles,
        blockers: uploadPhase.blockers,
        consistencyWarnings: uploadPhase.consistencyWarnings
      });
      appendUploadedFiles(uploadedFiles, uploadPhase.uploadedFiles);
      combinedWarnings = [...combinedWarnings, ...uploadPhase.consistencyWarnings];
      if (combinedWarnings.length > 0) {
        args.updateRunState?.({ consistencyWarnings: combinedWarnings });
      }

      if (uploadPhase.blockers.length > 0) {
        const reviewReason = uploadPhase.blockers.join("; ");
        browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, "needs_review", "reviewed");
        args.setStatus?.("needs_review", reviewReason);
        args.updateRunState?.({
          phase: "finished",
          browserKeptOpen,
          reviewReason,
          finalAction: "reviewed",
          consistencyWarnings: combinedWarnings
        });

        if (args.profile.settings.screenshotOnComplete) {
          await takeScreenshot();
        }

        return buildResult({
          startedAt,
          jobId: args.jobId,
          jobUrl: args.jobUrl,
          company: args.company,
          jobTitle: args.jobTitle,
          status: "needs_review",
          unknownFields,
          resumeUploadRequired: /resume|cv/i.test(reviewReason),
          notes: reviewReason,
          screenshotPath,
          finalAction: "reviewed",
          browserKeptOpen,
          reviewReason,
          uploadedFiles,
          consistencyWarnings: combinedWarnings
        });
      }
    }

    if (args.profile.settings.submissionMode === "review_before_submit") {
      const status = normalizeStatus(fillOutput.status, false);
      const notes = fillOutput.notes || fillPhase.result.message || "Ready for review before submit";
      browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, status, "reviewed");
      args.setStatus?.(status, notes);
      args.updateRunState?.({
        phase: "finished",
        browserKeptOpen,
        finalAction: "reviewed",
        consistencyWarnings: combinedWarnings
      });

      if (args.profile.settings.screenshotOnComplete) {
        await takeScreenshot();
      }

      return buildResult({
        startedAt,
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status,
        unknownFields,
        notes,
        screenshotPath,
        finalAction: "reviewed",
        browserKeptOpen,
        uploadedFiles,
        consistencyWarnings: combinedWarnings
      });
    }

    args.updateRunState?.({ phase: "finalizing" });
    const submitPhase = await runSubmitPhase(agent, page, executionVariables, args.onEvent);
    const allWarnings = [...combinedWarnings, ...submitPhase.consistencyWarnings];
    const submitNoProgressFailure =
      !submitPhase.progressVerified && submitPhase.progressCheckReliable && agentClaimsAction(submitPhase.result);

    if (submitPhase.result.success === false || submitPhase.result.completed === false || submitNoProgressFailure) {
      const reviewReason = submitNoProgressFailure
        ? "Submit phase reported actions without an observable completion change"
        : submitPhase.result.message || "Submit phase failed";
      const status = submitNoProgressFailure
        ? "failed"
        : classifyAgentMessage(submitPhase.result.message || "Submit phase failed").status;
      const finalAction: FinalAction = status === "needs_review" ? "reviewed" : "none";
      browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, status, finalAction);
      args.setStatus?.(status, reviewReason);
      args.updateRunState?.({
        phase: "finished",
        browserKeptOpen,
        reviewReason,
        finalAction,
        consistencyWarnings: allWarnings
      });

      if (args.profile.settings.screenshotOnComplete) {
        await takeScreenshot();
      }

      return buildResult({
        startedAt,
        jobId: args.jobId,
        jobUrl: args.jobUrl,
        company: args.company,
        jobTitle: args.jobTitle,
        status,
        unknownFields,
        notes: reviewReason,
        screenshotPath,
        finalAction,
        browserKeptOpen,
        reviewReason,
        uploadedFiles,
        consistencyWarnings: allWarnings
      });
    }

    const submitOutput = agentOutputSchema.parse(submitPhase.result.output ?? {});
    const submittedStatus = normalizeStatus(submitOutput.status, false);
    const submitNotes = submitOutput.notes || submitPhase.result.message || "Application submitted";
    browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, submittedStatus, "submitted");
    args.setStatus?.(submittedStatus, submitNotes);
    args.updateRunState?.({
      phase: "finished",
      browserKeptOpen,
      finalAction: "submitted",
      consistencyWarnings: allWarnings
    });

    if (args.profile.settings.screenshotOnComplete) {
      await takeScreenshot();
    }

    return buildResult({
      startedAt,
      jobId: args.jobId,
      jobUrl: args.jobUrl,
      company: args.company,
      jobTitle: args.jobTitle,
      status: submittedStatus,
      unknownFields,
      notes: submitNotes,
      screenshotPath,
      finalAction: "submitted",
      browserKeptOpen,
      uploadedFiles,
      consistencyWarnings: allWarnings
    });
  } catch (error) {
    debugLog("run_failed", { error: String(error) });
    args.onEvent?.("error", String(error));
    args.setStatus?.("failed", "Run failed");
    browserKeptOpen = shouldKeepBrowserOpen(args.profile.settings.keepBrowserOpenPolicy, "failed", "none");
    args.updateRunState?.({
      phase: "finished",
      browserKeptOpen,
      finalAction: "none"
    });
    return buildResult({
      startedAt,
      jobId: args.jobId,
      jobUrl: args.jobUrl,
      company: args.company,
      jobTitle: args.jobTitle,
      status: "failed",
      notes: `Error: ${String(error)}`,
      screenshotPath,
      finalAction: "none",
      browserKeptOpen
    });
  } finally {
    debugLog("run_finished", { browserKeptOpen, screenshotPath, debugLogPath: uploadDebug.logPath });
    if (!browserKeptOpen) {
      await stagehand?.close().catch(() => undefined);
    }
  }
}
