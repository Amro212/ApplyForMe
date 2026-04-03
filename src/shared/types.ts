export type ApplicationStatus =
  | "completed"
  | "needs_review"
  | "captcha_blocked"
  | "failed"
  | "resume_upload_required";

export type ActiveRunStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "needs_review"
  | "captcha_blocked"
  | "failed"
  | "resume_upload_required";

export type RunPhase = "starting" | "navigating" | "filling" | "uploading" | "finalizing" | "finished";
export type FinalAction = "none" | "reviewed" | "submitted";

export interface UploadedFileResult {
  fieldLabel: string;
  classification: "resume" | "cover_letter" | "attachment";
  filePath: string;
  required: boolean;
  outcome: "uploaded" | "blocked" | "skipped";
}

export interface ApplicationResult {
  timestamp: string;
  jobId: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  status: ApplicationStatus;
  unknownFields: string[];
  resumeUploadRequired: boolean;
  notes: string;
  durationSeconds: number;
  screenshotPath?: string;
  finalAction: FinalAction;
  browserKeptOpen: boolean;
  reviewReason?: string;
  uploadedFiles: UploadedFileResult[];
  consistencyWarnings: string[];
}

export interface RunEvent {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface ActiveRunState {
  runId: string;
  jobId: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  status: ActiveRunStatus;
  phase: RunPhase;
  summary: string;
  startedAt: string;
  finishedAt?: string;
  events: RunEvent[];
  browserKeptOpen: boolean;
  reviewReason?: string;
  consistencyWarnings: string[];
  finalAction: FinalAction;
  result?: ApplicationResult;
}
