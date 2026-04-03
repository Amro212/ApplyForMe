import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profilePayload = {
  personal: {
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 555 0100",
    address: "",
    city: "",
    province: "",
    country: "Canada",
    postalCode: "",
    linkedin: "https://linkedin.com/in/ada",
    github: "",
    portfolio: "",
    preferredName: "Ada"
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
    submissionMode: "review_before_submit",
    keepBrowserOpenPolicy: "failures_and_review",
    defaultAnswerForUnknown: "leave blank",
    screenshotOnComplete: true
  }
};

describe("App", () => {
  beforeEach(() => {
    let jobs = [
      {
        id: "job_1",
        company: "Acme",
        jobTitle: "Frontend Engineer",
        jobUrl: "https://example.com/jobs/1",
        notes: "Priority",
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z"
      }
    ];

    const fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/profile") && method === "GET") {
        return new Response(JSON.stringify(profilePayload), { status: 200 });
      }

      if (url.endsWith("/api/profile") && method === "POST") {
        return new Response(init?.body as BodyInit, { status: 200 });
      }

      if (url.endsWith("/api/jobs") && method === "GET") {
        return new Response(JSON.stringify(jobs), { status: 200 });
      }

      if (url.endsWith("/api/jobs") && method === "POST") {
        const parsed = JSON.parse(String(init?.body));
        const created = {
          ...parsed,
          id: "job_2",
          createdAt: "2026-04-02T00:01:00.000Z",
          updatedAt: "2026-04-02T00:01:00.000Z"
        };
        jobs = [...jobs, created];
        return new Response(JSON.stringify(created), { status: 201 });
      }

      if (url.endsWith("/api/runs") && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.endsWith("/api/runs/active") && method === "GET") {
        return new Response(JSON.stringify(null), { status: 200 });
      }

      if (url.endsWith("/api/runs") && method === "POST") {
        return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    class EventSourceStub {
      url: string;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
      }

      close() {}
    }

    vi.stubGlobal("EventSource", EventSourceStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads profile and jobs, saves the profile, and can queue a saved job run", async () => {
    const { App } = await import("../ui/src/App.js");

    render(<App />);

    expect(await screen.findByLabelText(/first name/i)).toHaveValue("Ada");
    expect(await screen.findByDisplayValue("Acme")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Grace" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: /save profile/i })[0]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/profile",
        expect.objectContaining({ method: "POST" })
      );
    });

    fireEvent.change(screen.getByLabelText(/company/i, { selector: "input[name='newJob.company']" }), {
      target: { value: "Beta" }
    });
    fireEvent.change(screen.getByLabelText(/job title/i, { selector: "input[name='newJob.jobTitle']" }), {
      target: { value: "Platform Engineer" }
    });
    fireEvent.change(screen.getByLabelText(/job url/i, { selector: "input[name='newJob.jobUrl']" }), {
      target: { value: "https://example.com/jobs/2" }
    });
    fireEvent.click(screen.getByRole("button", { name: /add job/i }));

    expect(await screen.findByDisplayValue("Beta")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /run job/i })[0]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("posts non-personal profile sections and settings when saving", async () => {
    const { App } = await import("../ui/src/App.js");

    render(<App />);

    expect(await screen.findByLabelText(/remote preference/i)).toHaveValue("no preference");
    const demographicSection = within(screen.getByRole("heading", { name: /demographic/i }).closest("section")!);
    const settingsSection = within(screen.getByRole("heading", { name: /application settings/i }).closest("section")!);

    fireEvent.change(screen.getByLabelText(/remote preference/i), {
      target: { value: "hybrid" }
    });
    fireEvent.click(screen.getAllByLabelText(/willing to relocate/i)[0]);
    fireEvent.change(screen.getByLabelText(/relocation cities/i), {
      target: { value: "Toronto, Vancouver" }
    });
    fireEvent.change(demographicSection.getByLabelText(/gender/i), {
      target: { value: "Male" }
    });
    fireEvent.change(demographicSection.getByLabelText(/pronouns/i), {
      target: { value: "he/him" }
    });
    fireEvent.change(settingsSection.getByLabelText(/cover letter file path/i), {
      target: { value: "./resumes/cover-letter.pdf" }
    });
    fireEvent.click(settingsSection.getByLabelText(/auto submit when safe/i));
    fireEvent.change(settingsSection.getByLabelText(/browser after run/i), {
      target: { value: "always" }
    });
    fireEvent.click(settingsSection.getByRole("button", { name: /add attachment mapping/i }));
    fireEvent.change(settingsSection.getByLabelText(/attachment label match 1/i), {
      target: { value: "portfolio" }
    });
    fireEvent.change(settingsSection.getByLabelText(/attachment file path 1/i), {
      target: { value: "./resumes/portfolio.pdf" }
    });
    fireEvent.click(settingsSection.getByLabelText(/screenshot on completion/i));
    fireEvent.click(screen.getAllByRole("button", { name: /save profile/i })[0]);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/profile",
        expect.objectContaining({
          method: "POST",
          body: expect.any(String)
        })
      );
    });

    const profileSaveCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => url === "/api/profile" && init?.method === "POST"
    );
    const postedProfile = JSON.parse(String(profileSaveCall?.[1]?.body));

    expect(postedProfile.preferences.remotePreference).toBe("hybrid");
    expect(postedProfile.preferences.willingToRelocate).toBe(true);
    expect(postedProfile.preferences.relocationCities).toEqual(["Toronto", "Vancouver"]);
    expect(postedProfile.demographic.gender).toBe("Male");
    expect(postedProfile.demographic.pronouns).toBe("he/him");
    expect(postedProfile.settings.coverLetterPath).toBe("./resumes/cover-letter.pdf");
    expect(postedProfile.settings.submissionMode).toBe("auto_submit");
    expect(postedProfile.settings.keepBrowserOpenPolicy).toBe("always");
    expect(postedProfile.settings.attachmentMappings).toEqual([
      expect.objectContaining({ labelContains: "portfolio", filePath: "./resumes/portfolio.pdf" })
    ]);
    expect(postedProfile.settings.screenshotOnComplete).toBe(false);
  });
});
