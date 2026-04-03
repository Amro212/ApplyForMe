import type { UserProfile } from "./types.js";

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
    preferredName: ""
  },
  workAuthorization: [
    { country: "Canada", authorized: true, requiresSponsorship: false },
    { country: "United States", authorized: false, requiresSponsorship: true }
  ],
  preferences: {
    jobTypes: ["full-time"],
    earliestStartDate: "",
    willingToRelocate: false,
    remotePreference: "no preference",
    salaryExpectation: "open",
    salaryCurrency: "CAD",
    noticePeriod: "immediately available"
  },
  education: [
    {
      degree: "",
      fieldOfStudy: "",
      university: "",
      graduationDate: "",
      gpa: "",
      gpaScale: "4.0"
    }
  ],
  experience: [],
  skills: [],
  languages: [{ language: "English", proficiency: "fluent" }],
  references: [],
  demographic: {
    veteranStatus: "prefer not to disclose",
    disabilityStatus: "prefer not to disclose",
    ethnicity: "prefer not to disclose",
    gender: "prefer not to disclose"
  },
  settings: {
    coverLetterStyle: "formal",
    resumePath: "./resumes/resume.pdf",
    coverLetterPath: "",
    attachmentMappings: [],
    submissionMode: "auto_submit",
    keepBrowserOpenPolicy: "failures_and_review",
    defaultAnswerForUnknown: "leave blank",
    screenshotOnComplete: true
  }
};
