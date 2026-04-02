import type { SavedJob } from "../../src/jobs/types.js";
import { Field, SectionCard } from "./uiUtils.js";

interface DraftJob {
  company: string;
  jobTitle: string;
  jobUrl: string;
  notes: string;
}

interface JobsPanelProps {
  jobs: SavedJob[];
  newJob: DraftJob;
  activeRunExists: boolean;
  onNewJobChange: (next: DraftJob) => void;
  onJobChange: (jobId: string, updates: Partial<SavedJob>) => void;
  onAddJob: () => void;
  onSaveJob: (job: SavedJob) => void;
  onDeleteJob: (jobId: string) => void;
  onRunJob: (jobId: string) => void;
}

export function JobsPanel(props: JobsPanelProps) {
  return (
    <div className="panel">
      <div className="toolbar">
        <div>
          <h2>Saved Jobs</h2>
          <p className="muted">Store reusable targets and launch one Stagehand run at a time.</p>
        </div>
      </div>

      <SectionCard title="Add Job">
        <div className="section-grid">
          <Field label="Company">
            <input
              name="newJob.company"
              value={props.newJob.company}
              onChange={(event) => props.onNewJobChange({ ...props.newJob, company: event.target.value })}
            />
          </Field>
          <Field label="Job title">
            <input
              name="newJob.jobTitle"
              value={props.newJob.jobTitle}
              onChange={(event) => props.onNewJobChange({ ...props.newJob, jobTitle: event.target.value })}
            />
          </Field>
          <Field label="Job URL">
            <input
              name="newJob.jobUrl"
              value={props.newJob.jobUrl}
              onChange={(event) => props.onNewJobChange({ ...props.newJob, jobUrl: event.target.value })}
            />
          </Field>
          <Field label="Notes">
            <input
              name="newJob.notes"
              value={props.newJob.notes}
              onChange={(event) => props.onNewJobChange({ ...props.newJob, notes: event.target.value })}
            />
          </Field>
        </div>
        <button className="button primary" type="button" onClick={props.onAddJob}>
          Add Job
        </button>
      </SectionCard>

      {props.jobs.map((job) => (
        <div className="section-card job-card" key={job.id}>
          <div className="section-grid">
            <Field label="Company">
              <input value={job.company} onChange={(event) => props.onJobChange(job.id, { company: event.target.value })} />
            </Field>
            <Field label="Job title">
              <input value={job.jobTitle} onChange={(event) => props.onJobChange(job.id, { jobTitle: event.target.value })} />
            </Field>
            <Field label="Job URL">
              <input value={job.jobUrl} onChange={(event) => props.onJobChange(job.id, { jobUrl: event.target.value })} />
            </Field>
            <Field label="Notes">
              <input value={job.notes} onChange={(event) => props.onJobChange(job.id, { notes: event.target.value })} />
            </Field>
          </div>
          <div className="inline-actions">
            <button className="button" type="button" onClick={() => props.onSaveJob(job)}>
              Save Job
            </button>
            <button
              className="button primary"
              type="button"
              disabled={props.activeRunExists}
              onClick={() => props.onRunJob(job.id)}
            >
              Run Job
            </button>
            <button className="button danger" type="button" onClick={() => props.onDeleteJob(job.id)}>
              Delete Job
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
