# Engineering Prompt: Stagehand-Only Job Application Automation System

## Context for the Agent

You are rebuilding a job application automation tool. The previous implementation used Playwright directly alongside Stagehand. That is being scrapped entirely. The new system uses **Stagehand v3 only** with **Gemini 2.5 Flash** as the model, running in `LOCAL` mode (no Browserbase). Playwright still runs under the hood inside Stagehand but is never called directly in our code. All browser interaction goes through Stagehand's API exclusively.

The system has two main parts:
1. A **user setup/onboarding UI** where the user fills in their profile once
2. An **automation engine** that reads that profile and applies to jobs using Stagehand

Read every step fully before executing. Each step is independently testable. Do not proceed to the next step until the current one passes its verification check.

---

## Project Structure to Create

```
job-applier/
├── .env
├── package.json
├── tsconfig.json
├── src/
│   ├── profile/
│   │   ├── types.ts           # UserProfile type definitions
│   │   ├── defaultProfile.ts  # Empty profile scaffold
│   │   └── storage.ts         # Read/write profile from disk
│   ├── agent/
│   │   ├── systemPrompt.ts    # Builds Gemini system prompt from profile
│   │   ├── safeDefaults.ts    # Answers to common questions not in profile
│   │   ├── applyToJob.ts      # Core automation entry point
│   │   └── resultLogger.ts    # Logs outcomes per application
│   ├── ui/
│   │   └── setupPage.tsx      # React onboarding UI (or plain HTML if no React)
│   └── index.ts               # CLI entry point
├── profiles/
│   └── user.json              # Saved user profile (gitignored)
├── logs/
│   └── applications.json      # Application results log
└── resumes/
    └── (user places resume PDF here)
```

---

## Step 1: Initialize the Project

### 1.1 — Create the project and install dependencies

```bash
mkdir job-applier && cd job-applier
npm init -y
npm install @browserbasehq/stagehand zod dotenv
npm install -D typescript @types/node tsx
npx tsc --init
```

### 1.2 — Configure tsconfig.json

Set the following in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### 1.3 — Create the .env file

```env
GEMINI_API_KEY=your_gemini_api_key_here
PROFILE_PATH=./profiles/user.json
LOG_PATH=./logs/applications.json
RESUME_PATH=./resumes/resume.pdf
HEADLESS=false
```

### 1.4 — Add scripts to package.json

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "apply": "tsx src/index.ts apply",
    "setup": "tsx src/index.ts setup"
  }
}
```

**Verification:** Run `npm run dev`. It should execute without crashing (index.ts doesn't exist yet, so it will error — that's fine, just confirm node/tsx resolves).

---

## Step 2: Define the User Profile Type

Create `src/profile/types.ts`. This is the single source of truth for all user data. Every field here maps to something that can appear on a job application.

```typescript
// src/profile/types.ts

export interface WorkAuthorization {
  country: string;
  authorized: boolean;
  requiresSponsorship: boolean;
}

export interface Education {
  degree: string;              // e.g. "Bachelor of Computer Engineering"
  fieldOfStudy: string;        // e.g. "Computer Engineering"
  university: string;
  graduationDate: string;      // e.g. "May 2026"
  gpa?: string;                // optional
  gpaScale?: string;           // e.g. "4.0"
}

export interface Experience {
  title: string;
  company: string;
  startDate: string;           // e.g. "September 2022"
  endDate: string;             // e.g. "April 2023" or "Present"
  location: string;
  summary: string;             // 2-3 sentence description
  responsibilities: string[];  // bullet points
}

export interface Skill {
  name: string;
  yearsOfExperience?: number;
  proficiencyLevel?: "beginner" | "intermediate" | "advanced" | "expert";
}

export interface Reference {
  name: string;
  title: string;
  company: string;
  email?: string;
  phone?: string;
  relationship: string;
}

export interface UserProfile {
  // === PERSONAL ===
  personal: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    province: string;           // or state
    country: string;
    postalCode: string;
    linkedin: string;
    github?: string;
    portfolio?: string;
    preferredName?: string;
  };

  // === WORK AUTHORIZATION ===
  workAuthorization: WorkAuthorization[];
  // One entry per country/region you want to handle (Canada, USA, UK, etc.)

  // === EMPLOYMENT PREFERENCES ===
  preferences: {
    jobTypes: ("full-time" | "part-time" | "contract" | "internship" | "co-op")[];
    earliestStartDate: string;   // e.g. "May 1, 2026"
    willingToRelocate: boolean;
    relocationCities?: string[];
    remotePreference: "remote" | "hybrid" | "on-site" | "no preference";
    salaryExpectation?: string;  // e.g. "70000-90000" or "open"
    salaryCurrency?: string;     // e.g. "CAD"
    noticePeriod?: string;       // e.g. "2 weeks" or "immediately available"
  };

  // === EDUCATION ===
  education: Education[];

  // === EXPERIENCE ===
  experience: Experience[];

  // === SKILLS ===
  skills: Skill[];

  // === LANGUAGES ===
  languages: {
    language: string;
    proficiency: "native" | "fluent" | "professional" | "conversational" | "basic";
  }[];

  // === REFERENCES ===
  references?: Reference[];

  // === DEMOGRAPHIC (all optional, user chooses to disclose or not) ===
  demographic?: {
    veteranStatus?: "not a veteran" | "veteran" | "prefer not to disclose";
    disabilityStatus?: "no disability" | "has disability" | "prefer not to disclose";
    ethnicity?: string | "prefer not to disclose";
    gender?: string | "prefer not to disclose";
    pronouns?: string;
  };

  // === APPLICATION SETTINGS ===
  settings: {
    coverLetterStyle: "formal" | "conversational" | "technical";
    resumePath: string;
    defaultAnswerForUnknown: "leave blank" | "prefer not to say";
    stopBeforeSubmit: boolean;   // always true during testing
    screenshotOnComplete: boolean;
  };
}
```

**Verification:** Import `UserProfile` in a temp file and TypeScript should resolve it without errors.

---

## Step 3: Create the Default Profile Scaffold

Create `src/profile/defaultProfile.ts`. This is the empty template used to initialize a new user's profile.

```typescript
// src/profile/defaultProfile.ts
import { UserProfile } from "./types";

export const defaultProfile: UserProfile = {
  personal: {
    firstName: "",
    lastName: "",
    fullName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    province: "",
    country: "Canada",
    postalCode: "",
    linkedin: "",
    github: "",
    portfolio: "",
    preferredName: "",
  },
  workAuthorization: [
    { country: "Canada", authorized: true, requiresSponsorship: false },
    { country: "United States", authorized: false, requiresSponsorship: true },
  ],
  preferences: {
    jobTypes: ["full-time"],
    earliestStartDate: "",
    willingToRelocate: false,
    remotePreference: "no preference",
    salaryExpectation: "open",
    salaryCurrency: "CAD",
    noticePeriod: "immediately available",
  },
  education: [
    {
      degree: "",
      fieldOfStudy: "",
      university: "",
      graduationDate: "",
      gpa: "",
      gpaScale: "4.0",
    }
  ],
  experience: [],
  skills: [],
  languages: [
    { language: "English", proficiency: "fluent" }
  ],
  references: [],
  demographic: {
    veteranStatus: "prefer not to disclose",
    disabilityStatus: "prefer not to disclose",
    ethnicity: "prefer not to disclose",
    gender: "prefer not to disclose",
  },
  settings: {
    coverLetterStyle: "formal",
    resumePath: "./resumes/resume.pdf",
    defaultAnswerForUnknown: "leave blank",
    stopBeforeSubmit: true,
    screenshotOnComplete: true,
  }
};
```

**Verification:** `defaultProfile` should satisfy the `UserProfile` type with no TypeScript errors.

---

## Step 4: Create Profile Storage

Create `src/profile/storage.ts`. This reads and writes the user profile to disk as JSON.

```typescript
// src/profile/storage.ts
import fs from "fs";
import path from "path";
import { UserProfile } from "./types";
import { defaultProfile } from "./defaultProfile";

const PROFILE_PATH = process.env.PROFILE_PATH ?? "./profiles/user.json";

export function profileExists(): boolean {
  return fs.existsSync(PROFILE_PATH);
}

export function loadProfile(): UserProfile {
  if (!profileExists()) {
    return defaultProfile;
  }
  const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
  return JSON.parse(raw) as UserProfile;
}

export function saveProfile(profile: UserProfile): void {
  const dir = path.dirname(PROFILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
  console.log(`Profile saved to ${PROFILE_PATH}`);
}
```

**Verification:** Call `saveProfile(defaultProfile)` from a test script. Confirm `profiles/user.json` is created with the correct structure.

---

## Step 5: Build the Safe Defaults Module

Create `src/agent/safeDefaults.ts`. This handles common questions that aren't in the user's profile but have safe, standard answers.

```typescript
// src/agent/safeDefaults.ts

export const safeDefaultsPromptSection = `
=== SAFE DEFAULTS FOR COMMON APPLICATION QUESTIONS ===

Use these answers when the question is not covered by the candidate profile.
These are pre-approved defaults. Do not deviate from them.

LEGAL / BACKGROUND:
- "Are you 18 years of age or older?" → Yes
- "Do you consent to a background check?" → Yes
- "Do you consent to a criminal record check?" → Yes
- "Do you consent to a credit check?" → Yes (unless profile says otherwise)
- "Do you agree to a drug/substance test?" → Yes
- "Do you agree to the terms and conditions?" → Yes / Agree
- "Do you agree to the privacy policy?" → Yes / Agree
- "Have you ever been convicted of a felony?" → No
- "Are you legally eligible to enter into a contract?" → Yes

LOGISTICS:
- "How did you hear about this role?" → Online job board
- "Are you able to work the required hours?" → Yes
- "Are you comfortable with the stated work schedule?" → Yes
- "Do you have reliable transportation or can commute to this location?" → Yes
- "Are you willing to travel for this role?" → Yes, occasionally
- "Are you comfortable working in a fast-paced environment?" → Yes
- "Are you a team player?" → Yes
- "Can you work independently?" → Yes
- "Are you comfortable with performance reviews?" → Yes
- "Have you applied to this company before?" → No (unless user specifies)

COMPENSATION:
- "What are your salary expectations?" → Use salaryExpectation from profile, or if "open" → "Open to discussion based on the full compensation package"
- "Are you comfortable with the listed salary range?" → Yes
- "Are you negotiable on compensation?" → Yes

TECHNICAL / ROLE-SPECIFIC:
- "Are you comfortable learning new tools and technologies?" → Yes
- "Are you able to perform the essential functions of this job with or without accommodation?" → Yes
- "Are you willing to undergo additional training?" → Yes
- "Do you have access to a computer and reliable internet?" → Yes

DEMOGRAPHIC (always use these — never guess or fill in real data unless profile says to disclose):
- Veteran status → "I am not a protected veteran" (or "prefer not to disclose" if profile says so)
- Disability status → "I do not have a disability" (or "prefer not to disclose")
- Race / ethnicity → "Decline to self-identify" (or "prefer not to disclose")
- Gender → "Prefer not to disclose" (unless profile specifies)
- Pronouns → Leave blank unless profile specifies
- Sexual orientation → "Prefer not to disclose"

REFERENCES:
- "May we contact your current employer?" → No
- "May we contact your references?" → Yes
- "Do you have professional references available?" → Yes

MISC:
- "Are you currently employed?" → Answer based on profile experience (if last job has no end date, say Yes)
- "Are you currently a student?" → Use graduation date from profile (if in future, say Yes)
- "Are you a recent graduate?" → Yes if graduation is within 12 months
- "What is your notice period?" → Use noticePeriod from profile
- "When are you available to start?" → Use earliestStartDate from profile
`;
```

**Verification:** Import this file. Confirm the string is accessible and non-empty.

---

## Step 6: Build the System Prompt Builder

Create `src/agent/systemPrompt.ts`. This converts the UserProfile object into the full natural language context Gemini will use throughout the entire session.

```typescript
// src/agent/systemPrompt.ts
import { UserProfile } from "../profile/types";
import { safeDefaultsPromptSection } from "./safeDefaults";

export function buildSystemPrompt(profile: UserProfile): string {
  const canadaAuth = profile.workAuthorization.find(w => w.country === "Canada");
  const usaAuth = profile.workAuthorization.find(w => w.country === "United States");

  const educationBlock = profile.education.map(e =>
    `- ${e.degree} in ${e.fieldOfStudy} | ${e.university} | Graduating: ${e.graduationDate}${e.gpa ? ` | GPA: ${e.gpa}/${e.gpaScale ?? "4.0"}` : ""}`
  ).join("\n");

  const experienceBlock = profile.experience.map(e => `
ROLE: ${e.title} at ${e.company}
DATES: ${e.startDate} – ${e.endDate}
LOCATION: ${e.location}
SUMMARY: ${e.summary}
RESPONSIBILITIES:
${e.responsibilities.map(r => `  - ${r}`).join("\n")}
`.trim()).join("\n\n");

  const skillsBlock = profile.skills.map(s =>
    `${s.name}${s.yearsOfExperience ? ` (${s.yearsOfExperience} years)` : ""}${s.proficiencyLevel ? ` — ${s.proficiencyLevel}` : ""}`
  ).join(", ");

  const authBlock = profile.workAuthorization.map(w =>
    `- ${w.country}: ${w.authorized ? "AUTHORIZED" : "NOT authorized"}, ${w.requiresSponsorship ? "REQUIRES sponsorship" : "does NOT require sponsorship"}`
  ).join("\n");

  return `
You are a job application assistant filling out online job application forms on behalf of a candidate.
Your job is to fill every field accurately, completely, and efficiently using only the data provided.
Never fabricate, invent, or guess factual information. Use safe defaults for common questions.
Never submit the form. Stop before any final submit/apply button and report completion.

=== CANDIDATE PROFILE ===

PERSONAL INFORMATION:
- Full legal name: ${profile.personal.fullName}
- Preferred name: ${profile.personal.preferredName || profile.personal.firstName}
- First name: ${profile.personal.firstName}
- Last name: ${profile.personal.lastName}
- Email: ${profile.personal.email}
- Phone: ${profile.personal.phone}
- Address: ${profile.personal.address}
- City: ${profile.personal.city}
- Province/State: ${profile.personal.province}
- Country: ${profile.personal.country}
- Postal/Zip code: ${profile.personal.postalCode}
- LinkedIn: ${profile.personal.linkedin}
${profile.personal.github ? `- GitHub: ${profile.personal.github}` : ""}
${profile.personal.portfolio ? `- Portfolio/Website: ${profile.personal.portfolio}` : ""}

WORK AUTHORIZATION:
${authBlock}
When asked "Are you authorized to work in Canada?" → Select YES / Authorized
When asked "Do you require sponsorship in Canada?" → Select NO
When asked "Are you authorized to work in the US?" → Select NO or "Require sponsorship"
When asked "Do you require sponsorship in the US?" → Select YES
For any other country not listed → assume sponsorship required

EMPLOYMENT PREFERENCES:
- Job types: ${profile.preferences.jobTypes.join(", ")}
- Earliest available start date: ${profile.preferences.earliestStartDate}
- Willing to relocate: ${profile.preferences.willingToRelocate ? "Yes" : "No"}
${profile.preferences.relocationCities ? `- Open to relocating to: ${profile.preferences.relocationCities.join(", ")}` : ""}
- Remote preference: ${profile.preferences.remotePreference}
- Salary expectation: ${profile.preferences.salaryExpectation} ${profile.preferences.salaryCurrency ?? ""}
- Notice period / availability: ${profile.preferences.noticePeriod}

EDUCATION:
${educationBlock}

WORK EXPERIENCE:
${experienceBlock || "No prior work experience listed."}

SKILLS:
${skillsBlock || "Not specified."}

LANGUAGES:
${profile.languages.map(l => `- ${l.language}: ${l.proficiency}`).join("\n")}

${profile.references && profile.references.length > 0 ? `
REFERENCES:
${profile.references.map(r => `- ${r.name}, ${r.title} at ${r.company} | ${r.relationship}${r.email ? ` | ${r.email}` : ""}`).join("\n")}
` : ""}

=== FORM-FILLING RULES ===

ALWAYS:
1. Fill every visible field that has a corresponding value in the candidate profile above.
2. Work top to bottom through the form. Do not skip fields.
3. For dropdowns, select the option that most closely matches the profile data semantically.
4. For radio buttons, click the correct one based on profile data.
5. For checkboxes, check all that apply based on profile.
6. For date fields, format as MM/DD/YYYY or YYYY-MM-DD depending on what the field shows.
7. For phone fields, enter as: ${profile.personal.phone} (adjust formatting to match the field's expected format).
8. After filling each page/section, pause and extract a summary of what was filled.
9. Wait for the page to fully load after any navigation or Next button click.

NEVER:
- Do NOT click any Submit, Apply, or Send Application button.
- Do NOT fabricate employment history, skills, or credentials not in this profile.
- Do NOT guess on required factual fields that are not in the profile or safe defaults.
- Do NOT fill CAPTCHA challenges — stop and report them immediately.
- Do NOT close the browser between steps.

UNKNOWN REQUIRED FIELDS:
If you encounter a required field where:
- The answer is not in the candidate profile
- It cannot be answered using the safe defaults below
- Guessing would be factually wrong or risky

Then:
1. Do NOT fill it in.
2. Continue filling all other fields.
3. At the end of the current page, report the unknown field using this exact format:
   UNKNOWN_FIELD: [exact label text] | type: [field type] | required: true

OPEN-ENDED ESSAY QUESTIONS:
If you encounter a question like "Why do you want to work here?", "Tell us about yourself",
"Describe a challenge you overcame", or any free-form prompt:
- Write a genuine, concise answer (100-200 words) based on the candidate's background above.
- Emphasize relevant experience, skills, and goals.
- Write in first person.
- Do not fabricate specific numbers, projects, or facts not in the profile.

RESUME UPLOAD FIELDS:
- If you encounter a file upload field for a resume/CV, do not attempt to upload.
- Report it as: RESUME_UPLOAD_REQUIRED: [field label]
- The upload will be handled separately by the automation script.

${safeDefaultsPromptSection}
`.trim();
}
```

**Verification:** Call `buildSystemPrompt(defaultProfile)` and `console.log` the result. It should print a full, readable prompt with all sections populated (mostly empty since defaultProfile has blank fields — that's expected).

---

## Step 7: Build the Result Logger

Create `src/agent/resultLogger.ts`. Every application attempt gets logged here regardless of outcome.

```typescript
// src/agent/resultLogger.ts
import fs from "fs";
import path from "path";

export type ApplicationStatus =
  | "completed"
  | "needs_review"
  | "captcha_blocked"
  | "failed"
  | "resume_upload_required";

export interface ApplicationResult {
  timestamp: string;
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  status: ApplicationStatus;
  unknownFields: string[];
  resumeUploadRequired: boolean;
  notes: string;
  durationSeconds: number;
}

const LOG_PATH = process.env.LOG_PATH ?? "./logs/applications.json";

export function logResult(result: ApplicationResult): void {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let existing: ApplicationResult[] = [];
  if (fs.existsSync(LOG_PATH)) {
    existing = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
  }

  existing.push(result);
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`📋 Result logged: ${result.status} — ${result.jobUrl}`);
}
```

**Verification:** Call `logResult(...)` with a dummy result. Confirm `logs/applications.json` is created with the entry.

---

## Step 8: Build the Core Automation Engine

Create `src/agent/applyToJob.ts`. This is the heart of the system. It uses Stagehand exclusively — no direct Playwright calls anywhere in this file.

```typescript
// src/agent/applyToJob.ts
import { Stagehand } from "@browserbasehq/stagehand";
import { UserProfile } from "../profile/types";
import { buildSystemPrompt } from "./systemPrompt";
import { logResult, ApplicationStatus } from "./resultLogger";

function parseUnknownFields(agentOutput: string): string[] {
  return agentOutput
    .split("\n")
    .filter(line => line.includes("UNKNOWN_FIELD:"))
    .map(line => line.replace("UNKNOWN_FIELD:", "").trim());
}

function checkForCaptcha(agentOutput: string): boolean {
  const lower = agentOutput.toLowerCase();
  return lower.includes("captcha") || lower.includes("recaptcha") || lower.includes("robot check");
}

function checkResumeUploadRequired(agentOutput: string): boolean {
  return agentOutput.includes("RESUME_UPLOAD_REQUIRED");
}

export async function applyToJob(
  jobUrl: string,
  profile: UserProfile,
  options?: { company?: string; jobTitle?: string }
): Promise<void> {
  const startTime = Date.now();
  let status: ApplicationStatus = "failed";
  let unknownFields: string[] = [];
  let resumeUploadRequired = false;
  let notes = "";

  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "google/gemini-2.5-flash",
    modelClientOptions: {
      apiKey: process.env.GEMINI_API_KEY!,
    },
    headless: process.env.HEADLESS === "true",
  });

  try {
    await stagehand.init();
    console.log("✅ Stagehand initialized");

    const systemPrompt = buildSystemPrompt(profile);

    const agent = stagehand.agent({
      modelName: "google/gemini-2.5-flash",
      modelClientOptions: { apiKey: process.env.GEMINI_API_KEY! },
      instructions: systemPrompt,
    });

    // Navigate to the job application
    await stagehand.page.goto(jobUrl);
    await stagehand.page.waitForLoadState("networkidle");
    console.log(`🌐 Navigated to: ${jobUrl}`);

    // === PHASE 1: Observe the page structure before doing anything ===
    const pageStructure = await stagehand.page.observe({
      instruction:
        "Describe the overall structure of this page. " +
        "How many steps or sections does the application have? " +
        "What fields are visible right now? " +
        "Is there a progress indicator? " +
        "Is this a single-page or multi-page form?"
    });
    console.log("📋 Page structure:", pageStructure);

    // === PHASE 2: Multi-step form filling loop ===
    let formComplete = false;
    let stepCount = 0;
    const maxSteps = 15; // safety cap — no real application has more than 15 pages

    while (!formComplete && stepCount < maxSteps) {
      console.log(`\n🔄 Processing step ${stepCount + 1}...`);

      // Check what's on the current page before filling
      const currentPageState = await stagehand.page.observe({
        instruction:
          "What fields are currently visible and unfilled on this page? " +
          "Are there any error messages? " +
          "Is there a submit or next button visible? " +
          "Are we on the final confirmation/submit page?"
      });
      console.log(`Step ${stepCount + 1} state:`, currentPageState);

      // Check if we've reached the final submit page
      const finalPageCheck = await stagehand.page.extract({
        instruction:
          "Is the primary call-to-action button on this page a final submit / apply / send application button? " +
          "Return a JSON object with: { isFinalSubmitPage: boolean, buttonLabel: string }",
        schema: {
          type: "object" as const,
          properties: {
            isFinalSubmitPage: { type: "boolean" as const },
            buttonLabel: { type: "string" as const },
          },
          required: ["isFinalSubmitPage"],
        }
      });

      if (finalPageCheck.isFinalSubmitPage) {
        console.log(`⛔ Reached final submit page. Button: "${finalPageCheck.buttonLabel}". Stopping as instructed.`);
        status = "completed";
        formComplete = true;
        break;
      }

      // Fill the current page/section
      const fillResult = await agent.execute(`
        Fill out every field on the current visible page using the candidate profile and safe defaults.
        Work top to bottom.
        For each field you fill, note the label and value you entered.
        When all visible fields on this page are filled, click the Next or Continue button if present.
        Do NOT click Submit or Apply.
        If you encounter a CAPTCHA, stop immediately and report: CAPTCHA_DETECTED
        If you encounter a file upload for a resume, do not upload — report: RESUME_UPLOAD_REQUIRED: [label]
        If there are required fields you cannot answer from the profile or safe defaults, report: UNKNOWN_FIELD: [label] | type: [type] | required: true
        After clicking Next/Continue, wait for the new page to fully load before stopping.
      `);

      console.log(`Step ${stepCount + 1} result:`, fillResult);

      // Parse the result for issues
      if (checkForCaptcha(fillResult?.toString() ?? "")) {
        console.log("🛑 CAPTCHA detected — stopping");
        status = "captcha_blocked";
        notes = "CAPTCHA encountered during form fill";
        break;
      }

      const stepUnknownFields = parseUnknownFields(fillResult?.toString() ?? "");
      if (stepUnknownFields.length > 0) {
        unknownFields.push(...stepUnknownFields);
        console.log("⚠️ Unknown fields found:", stepUnknownFields);
      }

      if (checkResumeUploadRequired(fillResult?.toString() ?? "")) {
        resumeUploadRequired = true;
        console.log("📎 Resume upload required — flagged for manual step");
      }

      // Wait for page transition
      await stagehand.page.waitForLoadState("networkidle");
      stepCount++;
    }

    if (stepCount >= maxSteps) {
      notes = `Hit max step limit (${maxSteps}) — possible infinite loop or unexpected form structure`;
      status = "needs_review";
    }

    if (unknownFields.length > 0 && status !== "captcha_blocked") {
      status = "needs_review";
    }

    if (status === "completed" || status === "needs_review") {
      // === PHASE 3: Verification — extract what was filled ===
      const filledSummary = await stagehand.page.extract({
        instruction:
          "List every field on this page and its current value. " +
          "Return as JSON array of { label: string, value: string, filled: boolean }",
        schema: {
          type: "object" as const,
          properties: {
            fields: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  label: { type: "string" as const },
                  value: { type: "string" as const },
                  filled: { type: "boolean" as const },
                }
              }
            }
          }
        }
      });
      console.log("✅ Final page summary:", JSON.stringify(filledSummary, null, 2));
    }

    // === PHASE 4: Screenshot if enabled ===
    if (profile.settings.screenshotOnComplete) {
      const screenshotPath = `./logs/screenshot_${Date.now()}.png`;
      await stagehand.page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
      notes += ` | Screenshot: ${screenshotPath}`;
    }

  } catch (error) {
    console.error("❌ Automation error:", error);
    status = "failed";
    notes = `Error: ${String(error)}`;
  } finally {
    await stagehand.close();
    console.log("🔒 Stagehand closed");

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    logResult({
      timestamp: new Date().toISOString(),
      jobUrl,
      company: options?.company,
      jobTitle: options?.jobTitle,
      status,
      unknownFields,
      resumeUploadRequired,
      notes,
      durationSeconds,
    });

    console.log(`\n📊 Done in ${durationSeconds}s — Status: ${status}`);
    if (unknownFields.length > 0) {
      console.log("⚠️ Review these fields manually:", unknownFields);
    }
  }
}
```

**Verification:** Import `applyToJob` in `src/index.ts` and call it with a simple test URL like `https://www.google.com` just to confirm Stagehand initializes and the browser opens. The function will run and fail gracefully since Google isn't a job form — that's fine.

---

## Step 9: Build the CLI Entry Point

Create `src/index.ts`.

```typescript
// src/index.ts
import dotenv from "dotenv";
dotenv.config();

import { loadProfile, saveProfile, profileExists } from "./profile/storage";
import { defaultProfile } from "./profile/defaultProfile";
import { applyToJob } from "./agent/applyToJob";

const command = process.argv[2];
const jobUrl = process.argv[3];

async function main() {
  if (command === "apply") {
    if (!jobUrl) {
      console.error("Usage: npm run apply <job_url>");
      process.exit(1);
    }

    if (!profileExists()) {
      console.error("No profile found. Run: npm run setup");
      process.exit(1);
    }

    const profile = loadProfile();
    console.log(`\n🚀 Applying to: ${jobUrl}`);
    console.log(`👤 Profile loaded: ${profile.personal.fullName}`);

    await applyToJob(jobUrl, profile);

  } else if (command === "setup") {
    console.log("📝 Opening setup page...");
    // This will be the UI — for now, prints instructions
    const profile = profileExists() ? loadProfile() : defaultProfile;
    console.log("Current profile:", JSON.stringify(profile, null, 2));
    console.log("\nEdit profiles/user.json directly, or the setup UI will handle this.");

  } else {
    console.log("Commands:");
    console.log("  npm run apply <job_url>   — Apply to a job");
    console.log("  npm run setup             — Open profile setup");
  }
}

main().catch(console.error);
```

**Verification:** Run `npm run dev`. Should print the command list. Run `npm run apply` without a URL — should print the usage error.

---

## Step 10: Build the Setup Page (User Onboarding UI)

Create `src/ui/setupPage.html`. This is a standalone HTML file the user opens in their browser to fill in their profile. It covers all the common (and some uncommon) questions asked on job applications, organized into sections. On save, it writes to `profiles/user.json` via a local API endpoint.

Build this as a single self-contained HTML file with inline CSS and JS. No framework required.

The setup page must include the following sections and fields:

### Section 1: Personal Information
- First name, last name, preferred name
- Email address
- Phone number (with country code selector)
- Street address, city, province/state, country, postal/zip code
- LinkedIn URL
- GitHub URL (optional)
- Portfolio/website URL (optional)

### Section 2: Work Authorization
- Dynamic list — user can add entries per country
- Each entry: country name, authorized yes/no, requires sponsorship yes/no

### Section 3: Employment Preferences
- Job type (checkboxes: full-time, part-time, contract, internship, co-op)
- Earliest available start date (date picker)
- Willing to relocate (yes/no toggle)
- Relocation cities (text, appears if willing to relocate)
- Remote preference (dropdown: remote, hybrid, on-site, no preference)
- Salary expectation (text + currency selector)
- Notice period (dropdown: immediately, 2 weeks, 1 month, 3 months, other)

### Section 4: Education
- Dynamic list — user can add multiple degrees
- Each entry: degree type, field of study, university name, graduation date, GPA, GPA scale

### Section 5: Work Experience
- Dynamic list — user can add multiple roles
- Each entry: job title, company, start date, end date (or "Present" checkbox), location, 2-3 sentence summary, responsibilities (dynamic bullet list)

### Section 6: Skills
- Dynamic list — user adds skills one by one
- Each skill: name, years of experience (optional), proficiency level dropdown

### Section 7: Languages
- Dynamic list
- Each entry: language name, proficiency level

### Section 8: References
- Dynamic list
- Each entry: name, title, company, relationship, email (optional), phone (optional)

### Section 9: Demographic (Optional)
- Label all fields clearly as "Optional — used only for EEO questions"
- Veteran status (dropdown: not a veteran, veteran, prefer not to disclose)
- Disability status (dropdown: no disability, has disability, prefer not to disclose)
- Ethnicity (text or prefer not to disclose)
- Gender (text or prefer not to disclose)
- Pronouns (text, optional)

### Section 10: Application Settings
- Cover letter style (radio: formal, conversational, technical)
- Resume file path (text input pointing to local file)
- Stop before submit (toggle — default ON during testing)
- Screenshot on completion (toggle)

### Save Behavior
- "Save Profile" button writes the form data to `profiles/user.json`
- Show a success toast on save
- On page load, pre-populate all fields from existing `profiles/user.json` if it exists
- Validate required fields (name, email, phone) before saving

**Implementation note:** Use a simple Express server endpoint (`POST /api/profile`) to handle saves, or write directly via a Node script the HTML calls. Keep it minimal — this is a local dev tool, not a production app.

**Verification:** Open the HTML file, fill in sample data, click Save. Confirm `profiles/user.json` is updated with the correct structure matching the `UserProfile` type.

---

## Step 11: End-to-End Test

Once all steps are complete, run a full test against a real job application.

### 11.1 — Fill your profile via the setup page
Open the setup page, fill in all fields, save.

### 11.2 — Run against a test application
Use a known, simple application form first. Recommended test targets (in order of complexity):
1. A Lever.co application (simplest — usually 1-2 pages)
2. A Greenhouse application (moderate — sometimes has custom questions)
3. A Workday application (complex — multi-step, lots of dropdowns)

```bash
npm run apply https://jobs.lever.co/[company]/[job-id]/apply
```

### 11.3 — Watch the browser
With `HEADLESS=false`, watch the browser fill fields in real time. Check:
- [ ] Fields are filling correctly from the profile
- [ ] Work authorization dropdowns are correct
- [ ] The agent stops before hitting Submit
- [ ] A screenshot is saved in `/logs`
- [ ] The result is logged in `logs/applications.json`
- [ ] Any unknown fields are reported correctly

### 11.4 — Check the log
Open `logs/applications.json`. Confirm the result entry has:
- Correct status
- Any unknown fields listed
- Duration recorded
- Screenshot path if applicable

---

## Step 12: Common Issues and How the Agent Should Handle Them

Document these in a `KNOWN_ISSUES.md` at project root. The agent should be aware of them.

| Issue | What to Do |
|---|---|
| CAPTCHA appears | Stop, log `captcha_blocked`, close browser |
| Page doesn't load after Next click | Wait 5 seconds, observe again, retry once |
| Dropdown options don't match profile | Select the semantically closest option |
| Required field not in profile or safe defaults | Log as `UNKNOWN_FIELD`, continue rest of form |
| File upload for resume | Flag `RESUME_UPLOAD_REQUIRED`, skip, continue |
| Multi-select checkbox question | Select all applicable options from profile |
| Date field format varies | Match whatever format the field shows (MM/DD/YYYY vs YYYY-MM-DD) |
| Phone number format validation | Strip all non-digits, re-enter in field's expected format |
| Salary field rejects "open" | Enter 0 or leave blank and note it |
| LinkedIn URL field | Use full URL: https://linkedin.com/in/[handle] |
| Application requires account creation | Stop, log `needs_review`, note "account creation required" |

---

## Deliverables Checklist

Before considering the implementation complete, verify all of the following:

- [ ] `src/profile/types.ts` — UserProfile type fully defined
- [ ] `src/profile/defaultProfile.ts` — empty scaffold created
- [ ] `src/profile/storage.ts` — read/write works correctly
- [ ] `src/agent/safeDefaults.ts` — safe defaults string built
- [ ] `src/agent/systemPrompt.ts` — builds full context prompt from profile
- [ ] `src/agent/applyToJob.ts` — automation engine using Stagehand only (no direct Playwright)
- [ ] `src/agent/resultLogger.ts` — logs every result to JSON
- [ ] `src/index.ts` — CLI works with `apply` and `setup` commands
- [ ] `src/ui/setupPage.html` — all 10 profile sections present and functional
- [ ] `.env` — GEMINI_API_KEY and paths configured
- [ ] End-to-end test passes on a Lever or Greenhouse application
- [ ] `logs/applications.json` — results being written correctly
- [ ] No direct Playwright imports anywhere outside Stagehand internals