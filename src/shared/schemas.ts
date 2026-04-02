import { z } from "zod";

export const workAuthorizationSchema = z.object({
  country: z.string().min(1),
  authorized: z.boolean(),
  requiresSponsorship: z.boolean()
});

export const educationSchema = z.object({
  degree: z.string(),
  fieldOfStudy: z.string(),
  university: z.string(),
  graduationDate: z.string(),
  gpa: z.string().optional(),
  gpaScale: z.string().optional()
});

export const experienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string())
});

export const skillSchema = z.object({
  name: z.string(),
  yearsOfExperience: z.number().optional(),
  proficiencyLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional()
});

export const referenceSchema = z.object({
  name: z.string(),
  title: z.string(),
  company: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  relationship: z.string()
});

export const userProfileSchema = z.object({
  personal: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    fullName: z.string().min(1),
    email: z.email(),
    phone: z.string().min(1),
    address: z.string(),
    city: z.string(),
    province: z.string(),
    country: z.string(),
    postalCode: z.string(),
    linkedin: z.string(),
    github: z.string().optional(),
    portfolio: z.string().optional(),
    preferredName: z.string().optional()
  }),
  workAuthorization: z.array(workAuthorizationSchema),
  preferences: z.object({
    jobTypes: z.array(z.enum(["full-time", "part-time", "contract", "internship", "co-op"])),
    earliestStartDate: z.string(),
    willingToRelocate: z.boolean(),
    relocationCities: z.array(z.string()).optional(),
    remotePreference: z.enum(["remote", "hybrid", "on-site", "no preference"]),
    salaryExpectation: z.string().optional(),
    salaryCurrency: z.string().optional(),
    noticePeriod: z.string().optional()
  }),
  education: z.array(educationSchema),
  experience: z.array(experienceSchema),
  skills: z.array(skillSchema),
  languages: z.array(
    z.object({
      language: z.string(),
      proficiency: z.enum(["native", "fluent", "professional", "conversational", "basic"])
    })
  ),
  references: z.array(referenceSchema).optional(),
  demographic: z
    .object({
      veteranStatus: z.enum(["not a veteran", "veteran", "prefer not to disclose"]).optional(),
      disabilityStatus: z.enum(["no disability", "has disability", "prefer not to disclose"]).optional(),
      ethnicity: z.string().optional(),
      gender: z.string().optional(),
      pronouns: z.string().optional()
    })
    .optional(),
  settings: z.object({
    coverLetterStyle: z.enum(["formal", "conversational", "technical"]),
    resumePath: z.string(),
    defaultAnswerForUnknown: z.enum(["leave blank", "prefer not to say"]),
    stopBeforeSubmit: z.boolean(),
    screenshotOnComplete: z.boolean()
  })
});

export const savedJobSchema = z.object({
  id: z.string(),
  company: z.string().min(1),
  jobTitle: z.string().min(1),
  jobUrl: z.url(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createSavedJobSchema = savedJobSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const updateSavedJobSchema = createSavedJobSchema;

export const runRequestSchema = z.object({
  jobId: z.string().min(1)
});
