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
  summary: string;
  startedAt: string;
  finishedAt?: string;
  events: RunEvent[];
  result?: ApplicationResult;
}
