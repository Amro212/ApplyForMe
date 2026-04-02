import type { ActiveRunState, ApplicationResult } from "../../src/shared/types.js";

interface RunsPanelProps {
  activeRun: ActiveRunState | null;
  runHistory: ApplicationResult[];
}

export function RunsPanel(props: RunsPanelProps) {
  return (
    <aside className="stack">
      <div className="panel">
        <h2>Runs</h2>
        {props.activeRun ? (
          <div className="history-card">
            <div className="toolbar">
              <strong>{props.activeRun.jobTitle || props.activeRun.company || props.activeRun.jobUrl}</strong>
              <span className="pill">{props.activeRun.status}</span>
            </div>
            <p>{props.activeRun.summary}</p>
            <div className="event-list">
              {props.activeRun.events.map((event) => (
                <div className="event" key={event.id}>
                  <strong>{event.level}</strong>
                  <div>{event.message}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">No active job run.</p>
        )}
      </div>

      <div className="panel">
        <h2>Run History</h2>
        <div className="stack">
          {props.runHistory.length === 0 ? (
            <p className="muted">No completed runs yet.</p>
          ) : (
            props.runHistory.map((entry) => (
              <article className="history-card" key={`${entry.jobId}-${entry.timestamp}`}>
                <div className="toolbar">
                  <strong>{entry.jobTitle || entry.company || entry.jobUrl}</strong>
                  <span className="pill">{entry.status}</span>
                </div>
                <div className="muted">{entry.jobUrl}</div>
                <div>{entry.notes}</div>
                {entry.unknownFields.length > 0 ? <div>Unknown fields: {entry.unknownFields.join(", ")}</div> : null}
                {entry.screenshotPath ? <div>Screenshot: {entry.screenshotPath}</div> : null}
              </article>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
