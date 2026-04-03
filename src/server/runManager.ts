import { randomUUID } from "node:crypto";
import type { SavedJob } from "../jobs/types.js";
import type { ActiveRunState, ActiveRunStatus, ApplicationResult, RunEvent, RunPhase, FinalAction } from "../shared/types.js";

interface RunContext {
  onEvent: (level: RunEvent["level"], message: string) => void;
  setStatus: (status: ActiveRunStatus, summary: string) => void;
  updateRunState: (patch: Partial<Pick<ActiveRunState, "phase" | "browserKeptOpen" | "reviewReason" | "consistencyWarnings" | "finalAction">>) => void;
}

interface RunManagerOptions {
  runJob: (args: {
    job: SavedJob;
    onEvent: RunContext["onEvent"];
    setStatus: RunContext["setStatus"];
    updateRunState: RunContext["updateRunState"];
  }) => Promise<ApplicationResult>;
  onEvent?: (event: RunEvent, state: ActiveRunState) => void;
}

export class RunManager {
  private activeRun: ActiveRunState | null = null;
  private readonly history: ApplicationResult[] = [];
  private readonly options: RunManagerOptions;
  private readonly listeners = new Set<(state: ActiveRunState | null) => void>();

  constructor(options: RunManagerOptions) {
    this.options = options;
  }

  getActiveRun(): ActiveRunState | null {
    return this.activeRun ? structuredClone(this.activeRun) : null;
  }

  getHistory(): ApplicationResult[] {
    return structuredClone(this.history);
  }

  subscribe(listener: (state: ActiveRunState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.getActiveRun());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getActiveRun();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  async startRun(job: SavedJob): Promise<ApplicationResult> {
    if (this.activeRun) {
      throw new Error("A job run is already in progress");
    }

    const runId = randomUUID();
    this.activeRun = {
      runId,
      jobId: job.id,
      jobUrl: job.jobUrl,
      company: job.company,
      jobTitle: job.jobTitle,
      status: "starting",
      phase: "starting",
      summary: "Preparing job application run",
      startedAt: new Date().toISOString(),
      events: [],
      browserKeptOpen: false,
      consistencyWarnings: [],
      finalAction: "none"
    };
    this.emit();

    const onEvent = (level: RunEvent["level"], message: string) => {
      if (!this.activeRun) {
        return;
      }

      const event: RunEvent = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        message
      };
      this.activeRun.events.push(event);
      this.options.onEvent?.(event, structuredClone(this.activeRun));
      this.emit();
    };

    const setStatus = (status: ActiveRunStatus, summary: string) => {
      if (!this.activeRun) {
        return;
      }

      this.activeRun.status = status;
      this.activeRun.summary = summary;
      this.emit();
    };

    const updateRunState = (
      patch: Partial<Pick<ActiveRunState, "phase" | "browserKeptOpen" | "reviewReason" | "consistencyWarnings" | "finalAction">>
    ) => {
      if (!this.activeRun) {
        return;
      }

      this.activeRun = {
        ...this.activeRun,
        ...patch
      };
      this.emit();
    };

    try {
      const result = await this.options.runJob({ job, onEvent, setStatus, updateRunState });
      if (this.activeRun) {
        this.activeRun.status = result.status;
        this.activeRun.phase = "finished";
        this.activeRun.summary = result.notes || "Run completed";
        this.activeRun.finishedAt = new Date().toISOString();
        this.activeRun.browserKeptOpen = result.browserKeptOpen;
        this.activeRun.reviewReason = result.reviewReason;
        this.activeRun.consistencyWarnings = result.consistencyWarnings;
        this.activeRun.finalAction = result.finalAction;
        this.activeRun.result = result;
        this.emit();
      }
      this.history.unshift(result);
      return result;
    } finally {
      this.activeRun = null;
      this.emit();
    }
  }
}
