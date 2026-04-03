import fs from "node:fs";
import path from "node:path";
import { defaultProfile } from "./defaultProfile.js";
import type { AttachmentMapping, KeepBrowserOpenPolicy, SubmissionMode, UserProfile } from "./types.js";
import { getProfilePath } from "../shared/paths.js";

type LegacySettings = Partial<UserProfile["settings"]> & {
  stopBeforeSubmit?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function mergeSettings(rawSettings: unknown): UserProfile["settings"] {
  const settingsRecord = asRecord(rawSettings) ?? {};
  const legacySettings = settingsRecord as LegacySettings;

  const submissionMode =
    typeof settingsRecord.submissionMode === "string"
      ? (settingsRecord.submissionMode as SubmissionMode)
      : legacySettings.stopBeforeSubmit === false
        ? "auto_submit"
        : "review_before_submit";
  const keepBrowserOpenPolicy =
    typeof settingsRecord.keepBrowserOpenPolicy === "string"
      ? (settingsRecord.keepBrowserOpenPolicy as KeepBrowserOpenPolicy)
      : defaultProfile.settings.keepBrowserOpenPolicy;
  const attachmentMappings = Array.isArray(settingsRecord.attachmentMappings)
    ? settingsRecord.attachmentMappings
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map(
          (entry, index): AttachmentMapping => ({
            id: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `attachment_${index + 1}`,
            labelContains: typeof entry.labelContains === "string" ? entry.labelContains : "",
            filePath: typeof entry.filePath === "string" ? entry.filePath : ""
          })
        )
        .filter((entry) => entry.labelContains.length > 0 || entry.filePath.length > 0)
    : [];

  return {
    ...defaultProfile.settings,
    ...settingsRecord,
    coverLetterPath: typeof settingsRecord.coverLetterPath === "string" ? settingsRecord.coverLetterPath : "",
    attachmentMappings,
    submissionMode,
    keepBrowserOpenPolicy
  };
}

function normalizeProfile(raw: unknown): UserProfile {
  const profileRecord = asRecord(raw) ?? {};

  return {
    ...defaultProfile,
    ...profileRecord,
    personal: {
      ...defaultProfile.personal,
      ...(asRecord(profileRecord.personal) ?? {})
    },
    workAuthorization: Array.isArray(profileRecord.workAuthorization)
      ? (profileRecord.workAuthorization as UserProfile["workAuthorization"])
      : structuredClone(defaultProfile.workAuthorization),
    preferences: {
      ...defaultProfile.preferences,
      ...(asRecord(profileRecord.preferences) ?? {})
    },
    education: Array.isArray(profileRecord.education) ? (profileRecord.education as UserProfile["education"]) : [],
    experience: Array.isArray(profileRecord.experience) ? (profileRecord.experience as UserProfile["experience"]) : [],
    skills: Array.isArray(profileRecord.skills) ? (profileRecord.skills as UserProfile["skills"]) : [],
    languages: Array.isArray(profileRecord.languages)
      ? (profileRecord.languages as UserProfile["languages"])
      : structuredClone(defaultProfile.languages),
    references: Array.isArray(profileRecord.references) ? (profileRecord.references as UserProfile["references"]) : [],
    demographic: {
      ...(defaultProfile.demographic ?? {}),
      ...(asRecord(profileRecord.demographic) ?? {})
    },
    settings: mergeSettings(profileRecord.settings)
  };
}

export function profileExists(): boolean {
  return fs.existsSync(getProfilePath());
}

export function loadProfile(): UserProfile {
  const profilePath = getProfilePath();
  if (!fs.existsSync(profilePath)) {
    return structuredClone(defaultProfile);
  }

  const raw = fs.readFileSync(profilePath, "utf-8");
  return normalizeProfile(JSON.parse(raw));
}

export function saveProfile(profile: UserProfile): void {
  const profilePath = getProfilePath();
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");
}
