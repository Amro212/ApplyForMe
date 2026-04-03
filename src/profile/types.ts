export interface WorkAuthorization {
  country: string;
  authorized: boolean;
  requiresSponsorship: boolean;
}

export interface Education {
  degree: string;
  fieldOfStudy: string;
  university: string;
  graduationDate: string;
  gpa?: string;
  gpaScale?: string;
}

export interface Experience {
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  location: string;
  summary: string;
  responsibilities: string[];
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

export interface AttachmentMapping {
  id: string;
  labelContains: string;
  filePath: string;
}

export type SubmissionMode = "review_before_submit" | "auto_submit";
export type KeepBrowserOpenPolicy = "never" | "failures_and_review" | "always";

export interface UserProfile {
  personal: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    province: string;
    country: string;
    postalCode: string;
    linkedin: string;
    github?: string;
    portfolio?: string;
    preferredName?: string;
  };
  workAuthorization: WorkAuthorization[];
  preferences: {
    jobTypes: ("full-time" | "part-time" | "contract" | "internship" | "co-op")[];
    earliestStartDate: string;
    willingToRelocate: boolean;
    relocationCities?: string[];
    remotePreference: "remote" | "hybrid" | "on-site" | "no preference";
    salaryExpectation?: string;
    salaryCurrency?: string;
    noticePeriod?: string;
  };
  education: Education[];
  experience: Experience[];
  skills: Skill[];
  languages: {
    language: string;
    proficiency: "native" | "fluent" | "professional" | "conversational" | "basic";
  }[];
  references?: Reference[];
  demographic?: {
    veteranStatus?: "not a veteran" | "veteran" | "prefer not to disclose";
    disabilityStatus?: "no disability" | "has disability" | "prefer not to disclose";
    ethnicity?: string | "prefer not to disclose";
    gender?: string | "prefer not to disclose";
    pronouns?: string;
  };
  settings: {
    coverLetterStyle: "formal" | "conversational" | "technical";
    resumePath: string;
    coverLetterPath: string;
    attachmentMappings: AttachmentMapping[];
    submissionMode: SubmissionMode;
    keepBrowserOpenPolicy: KeepBrowserOpenPolicy;
    defaultAnswerForUnknown: "leave blank" | "prefer not to say";
    screenshotOnComplete: boolean;
  };
}
