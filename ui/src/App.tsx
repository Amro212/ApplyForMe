import { startTransition, useEffect, useState } from "react";
import type { UserProfile } from "../../src/profile/types.js";
import type { SavedJob } from "../../src/jobs/types.js";
import type { ActiveRunState, ApplicationResult } from "../../src/shared/types.js";
import { JobsPanel } from "./JobsPanel.js";
import { ProfilePanel } from "./ProfilePanel.js";
import { RunsPanel } from "./RunsPanel.js";

interface NoticeState {
  type: "success" | "error";
  message: string;
}

interface DraftJob {
  company: string;
  jobTitle: string;
  jobUrl: string;
  notes: string;
}

const emptyDraftJob: DraftJob = {
  company: "",
  jobTitle: "",
  jobUrl: "",
  notes: ""
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function normalizeProfile(profile: UserProfile): UserProfile {
  return {
    ...profile,
    personal: {
      ...profile.personal,
      fullName: `${profile.personal.firstName} ${profile.personal.lastName}`.trim()
    }
  };
}

export function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [runHistory, setRunHistory] = useState<ApplicationResult[]>([]);
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [newJob, setNewJob] = useState<DraftJob>(emptyDraftJob);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  async function loadDashboard() {
    const [profilePayload, jobsPayload, historyPayload, activePayload] = await Promise.all([
      fetchJson<UserProfile>("/api/profile"),
      fetchJson<SavedJob[]>("/api/jobs"),
      fetchJson<ApplicationResult[]>("/api/runs"),
      fetchJson<ActiveRunState | null>("/api/runs/active")
    ]);

    startTransition(() => {
      setProfile(profilePayload);
      setJobs(jobsPayload);
      setRunHistory(historyPayload);
      setActiveRun(activePayload);
      setLoading(false);
    });
  }

  useEffect(() => {
    loadDashboard().catch((error) => {
      setNotice({ type: "error", message: String(error) });
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/runs/stream");
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ActiveRunState | null;
      setActiveRun(payload);
      if (payload === null) {
        void fetchJson<ApplicationResult[]>("/api/runs").then(setRunHistory).catch(() => undefined);
      }
    };
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, []);

  if (loading || !profile) {
    return <main className="app-shell">Loading dashboard…</main>;
  }

  const currentProfile = profile;

  async function saveProfile() {
    if (!currentProfile.personal.firstName || !currentProfile.personal.lastName || !currentProfile.personal.email || !currentProfile.personal.phone) {
      setNotice({ type: "error", message: "First name, last name, email, and phone are required." });
      return;
    }

    const saved = await fetchJson<UserProfile>("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalizeProfile(currentProfile))
    });
    setProfile(saved);
    setNotice({ type: "success", message: "Profile saved." });
  }

  async function addJob() {
    const created = await fetchJson<SavedJob>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newJob)
    });
    setJobs((current) => [...current, created]);
    setNewJob(emptyDraftJob);
    setNotice({ type: "success", message: "Job added." });
  }

  async function saveJob(job: SavedJob) {
    const saved = await fetchJson<SavedJob>(`/api/jobs/${job.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: job.company,
        jobTitle: job.jobTitle,
        jobUrl: job.jobUrl,
        notes: job.notes
      })
    });
    setJobs((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)));
    setNotice({ type: "success", message: "Job updated." });
  }

  async function deleteJob(jobId: string) {
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    setJobs((current) => current.filter((job) => job.id !== jobId));
    setNotice({ type: "success", message: "Job deleted." });
  }

  async function startRun(jobId: string) {
    await fetchJson("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId })
    });
    setNotice({ type: "success", message: "Job run started." });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <article className="hero-card">
          <p className="pill">Stagehand v3 only</p>
          <h1>Job application control room</h1>
          <p>Complete the profile once, manage reusable targets, and run Stagehand from one local dashboard.</p>
        </article>
        <aside className="hero-metrics hero-card">
          <div className="metric">
            <span className="muted">Saved jobs</span>
            <strong>{jobs.length}</strong>
          </div>
          <div className="metric">
            <span className="muted">Run history</span>
            <strong>{runHistory.length}</strong>
          </div>
          <div className="metric">
            <span className="muted">Active status</span>
            <strong>{activeRun ? activeRun.status : "idle"}</strong>
          </div>
        </aside>
      </section>

      <section className="layout">
        <div className="stack">
          <ProfilePanel profile={currentProfile} notice={notice} onChange={setProfile} onSave={() => void saveProfile()} />
          <JobsPanel
            jobs={jobs}
            newJob={newJob}
            activeRunExists={Boolean(activeRun)}
            onNewJobChange={setNewJob}
            onJobChange={(jobId, updates) =>
              setJobs((current) => current.map((entry) => (entry.id === jobId ? { ...entry, ...updates } : entry)))
            }
            onAddJob={() => void addJob()}
            onSaveJob={(job) => void saveJob(job)}
            onDeleteJob={(jobId) => void deleteJob(jobId)}
            onRunJob={(jobId) => void startRun(jobId)}
          />
        </div>
        <RunsPanel activeRun={activeRun} runHistory={runHistory} />
      </section>
    </main>
  );
}
