import { describe, expect, it } from "vitest";
import { defaultProfile } from "../src/profile/defaultProfile.js";
import { buildSystemPrompt } from "../src/agent/systemPrompt.js";

describe("buildSystemPrompt", () => {
  it("includes demographic and settings fields from the UI profile", () => {
    const prompt = buildSystemPrompt({
      ...defaultProfile,
      demographic: {
        veteranStatus: "not a veteran",
        disabilityStatus: "no disability",
        ethnicity: "Arab",
        gender: "Male",
        pronouns: "he/him"
      },
      settings: {
        ...defaultProfile.settings,
        coverLetterStyle: "technical",
        coverLetterPath: "./resumes/cover-letter.pdf",
        submissionMode: "auto_submit",
        keepBrowserOpenPolicy: "always",
        attachmentMappings: [{ id: "portfolio", labelContains: "portfolio", filePath: "./resumes/portfolio.pdf" }],
        defaultAnswerForUnknown: "prefer not to say"
      }
    });

    expect(prompt).toContain("DEMOGRAPHIC INFORMATION:");
    expect(prompt).toContain("- Gender: Male");
    expect(prompt).toContain("- Pronouns: he/him");
    expect(prompt).toContain("- Veteran status: not a veteran");
    expect(prompt).toContain("- Disability status: no disability");
    expect(prompt).toContain("- Ethnicity: Arab");
    expect(prompt).toContain("APPLICATION SETTINGS:");
    expect(prompt).toContain("- Cover letter style: technical");
    expect(prompt).toContain("- Default answer for unknown fields: prefer not to say");
    expect(prompt).toContain("- Submission mode: auto_submit");
    expect(prompt).toContain("- Keep browser open policy: always");
  });
});
