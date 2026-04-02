import fs from "node:fs";
import path from "node:path";
import { defaultProfile } from "./defaultProfile.js";
import type { UserProfile } from "./types.js";
import { getProfilePath } from "../shared/paths.js";

export function profileExists(): boolean {
  return fs.existsSync(getProfilePath());
}

export function loadProfile(): UserProfile {
  const profilePath = getProfilePath();
  if (!fs.existsSync(profilePath)) {
    return structuredClone(defaultProfile);
  }

  const raw = fs.readFileSync(profilePath, "utf-8");
  return JSON.parse(raw) as UserProfile;
}

export function saveProfile(profile: UserProfile): void {
  const profilePath = getProfilePath();
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");
}
