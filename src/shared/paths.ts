export function getProfilePath(): string {
  return process.env.PROFILE_PATH ?? "./profiles/user.json";
}

export function getJobsPath(): string {
  return process.env.JOBS_PATH ?? "./profiles/jobs.json";
}

export function getLogPath(): string {
  return process.env.LOG_PATH ?? "./logs/applications.json";
}

export function getResumePath(): string {
  return process.env.RESUME_PATH ?? "./resumes/resume.pdf";
}
