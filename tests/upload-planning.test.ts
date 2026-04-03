import { describe, expect, it } from "vitest";

describe("file upload planning", () => {
  it("matches resume, cover letter, and extra attachment mappings to file inputs", async () => {
    const { planFileUploads } = await import("../src/agent/applyToJob.js");

    const plan = planFileUploads(
      {
        resumePath: "C:/docs/resume.pdf",
        coverLetterPath: "C:/docs/cover-letter.pdf",
        attachmentMappings: [{ id: "portfolio", labelContains: "portfolio", filePath: "C:/docs/portfolio.pdf" }]
      },
      [
        {
          index: 0,
          label: "Resume / CV",
          required: true,
          descriptors: ["resume", "curriculum vitae"]
        },
        {
          index: 1,
          label: "Cover letter",
          required: false,
          descriptors: ["cover letter"]
        },
        {
          index: 2,
          label: "Portfolio or sample work",
          required: false,
          descriptors: ["portfolio", "sample work"]
        }
      ]
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.uploads).toEqual([
      expect.objectContaining({ index: 0, classification: "resume", filePath: "C:/docs/resume.pdf" }),
      expect.objectContaining({ index: 1, classification: "cover_letter", filePath: "C:/docs/cover-letter.pdf" }),
      expect.objectContaining({ index: 2, classification: "attachment", filePath: "C:/docs/portfolio.pdf" })
    ]);
  });

  it("blocks submission when a required file input has no single matching file", async () => {
    const { planFileUploads } = await import("../src/agent/applyToJob.js");

    const plan = planFileUploads(
      {
        resumePath: "",
        coverLetterPath: "",
        attachmentMappings: []
      },
      [
        {
          index: 0,
          label: "Resume / CV",
          required: true,
          descriptors: ["resume", "curriculum vitae"]
        }
      ]
    );

    expect(plan.uploads).toEqual([]);
    expect(plan.blockers[0]).toContain("Resume / CV");
  });
});
