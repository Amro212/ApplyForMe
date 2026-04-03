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
            <div>Phase: {props.activeRun.phase}</div>
            <div>Final action: {props.activeRun.finalAction}</div>
            {props.activeRun.reviewReason ? <div>Review reason: {props.activeRun.reviewReason}</div> : null}
            {props.activeRun.browserKeptOpen ? <div>Browser left open for review.</div> : null}
            {props.activeRun.consistencyWarnings.length > 0 ? (
              <div>Consistency warnings: {props.activeRun.consistencyWarnings.join(", ")}</div>
            ) : null}
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
                <div>Final action: {entry.finalAction}</div>
                {entry.reviewReason ? <div>Review reason: {entry.reviewReason}</div> : null}
                {entry.browserKeptOpen ? <div>Browser left open for review.</div> : null}
                {entry.uploadedFiles.length > 0 ? (
                  <div>
                    Uploads:{" "}
                    {entry.uploadedFiles
                      .map((upload) => `${upload.fieldLabel} (${upload.classification}, ${upload.outcome})`)
                      .join(", ")}
                  </div>
                ) : null}
                {entry.consistencyWarnings.length > 0 ? <div>Consistency warnings: {entry.consistencyWarnings.join(", ")}</div> : null}
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
