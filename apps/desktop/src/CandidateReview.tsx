import type { CandidateDiff, CandidateView, RunRecord } from "@luuna/api-client";
import { canCancel, canRevalidate, canValidate } from "./workflow-state";
import { nextStep } from "./failures";
import { StatusBadge } from "./design/StatusBadge";
import { candidateTone, checkTone, severityTone, verdictTone } from "./design/tone";

interface Props {
  run: RunRecord;
  view: CandidateView;
  diff?: CandidateDiff;
  busy: boolean;
  log?: { candidateHash: string; artifactId: string; text: string };
  onValidate: () => void;
  onRepair: () => void;
  onCancel: () => void;
  onDiff: () => void;
  onArtifact: (id: string) => void;
}

/** Displays durable runtime evidence; worker prose never decides these controls. */
export function CandidateReview({ run, view, diff, log, busy, onValidate, onRepair, onCancel, onDiff, onArtifact }: Props) {
  const evidence = view.evidence;
  if (!evidence) return null;
  const candidate = evidence.candidate;
  const boundDiff = diff?.candidate_hash === candidate.hash ? diff : undefined;
  const boundLog = log?.candidateHash === candidate.hash && evidence.results.some((result) => result.artifact_refs.includes(log.artifactId)) ? log : undefined;
  const review = evidence.review?.candidate_hash === candidate.hash ? evidence.review : undefined;
  return <section className="candidate-review subpanel" aria-label={`Candidate revision ${candidate.revision}`}>
    <div className="candidate-heading"><strong>Candidate r{candidate.revision}</strong><StatusBadge tone={candidateTone[evidence.status]}>{evidence.status.replace(/_/g, " ")}</StatusBadge></div>
    <dl className="facts">
      <div><dt>Candidate hash</dt><dd><code>{candidate.hash}</code></dd></div>
      <div><dt>Approved plan hash</dt><dd><code>{candidate.plan_hash}</code></dd></div>
      {Object.entries(candidate.repository_commits).map(([id, commit]) => <div key={id}><dt>{id} commit</dt><dd><code>{commit}</code></dd></div>)}
      {Object.entries(evidence.repository_trees).map(([id, tree]) => <div key={`${id}-tree`}><dt>{id} tree</dt><dd><code>{tree}</code></dd></div>)}
    </dl>
    <div className="ticket-actions actions">
      <button type="button" disabled={busy} onClick={onDiff}>Inspect candidate diff</button>
      {canValidate(run, view) && <button type="button" className="primary" disabled={busy} onClick={onValidate}>{canRevalidate(run, view) ? "Re-validate and review" : "Validate and review"}</button>}
      {view.repair_allowed && !view.active && <button type="button" disabled={busy} onClick={onRepair}>Repair candidate</button>}
      {canCancel(run.state, view.active) && <button type="button" className="danger" disabled={busy} onClick={onCancel}>Cancel workflow</button>}
    </div>
    {view.active && <p className="callout" data-tone="active" role="status">The runtime is {run.state === "implementing" ? "running the scoped writer repair" : evidence.status === "reviewing" ? "running the independent reviewer" : "executing the approved checks"}. Closing this view does not cancel the workflow.</p>}
    {evidence.reason && <p className="failure-note" data-tone={candidateTone[evidence.status]}>{evidence.reason}</p>}
    {evidence.reason && !canRevalidate(run, view) && !view.active && nextStep(evidence.reason) && <p className="recovery-note">{nextStep(evidence.reason)}</p>}
    {canRevalidate(run, view) && <p className="recovery-note">Required checks passed in validation generation {evidence.validation_generation} but no review verdict was recorded. Re-validation starts a fresh generation for this same candidate revision under the existing approval and budgets: the checks run again and a fresh reviewer session is started. No writer attempt is spent.</p>}
    {boundDiff && <details open className="candidate-diff"><summary>Diff for <code>{boundDiff.candidate_hash}</code></summary><p className="diff-meta">{boundDiff.repository_id} · base <code>{boundDiff.base_commit}</code> · candidate commit <code>{boundDiff.commit}</code></p><pre aria-label="Candidate diff" tabIndex={0}>{boundDiff.diff || "No changes."}</pre></details>}
    <details className="candidate-checks" open={evidence.results.length > 0}>
      <summary>Check evidence · {evidence.results.length} recorded result(s)</summary>
      {evidence.results.length === 0 && <p className="empty">No check results recorded for this candidate.</p>}
      <ul className="recipes record-list" aria-label="Candidate check results">{evidence.results.map((result) => <li key={result.id} className="record check-record" data-tone={checkTone[result.status]}>
        <strong>{result.recipe_id}</strong><StatusBadge tone={checkTone[result.status]}>{result.status}</StatusBadge>
        <code className="check-command">{result.command.join(" ")}</code>
        <dl className="facts">
          <div><dt>Candidate hash</dt><dd><code>{result.candidate_hash}</code></dd></div>
          <div><dt>Commit</dt><dd><code>{result.commit}</code></dd></div>
          <div><dt>Environment</dt><dd><code>{result.environment_fingerprint}</code></dd></div>
          <div><dt>Exit code</dt><dd>{result.exit_code ?? "not recorded"}</dd></div>
          {result.tests_detected !== undefined && <div><dt>Tests detected</dt><dd>{result.tests_detected}</dd></div>}
        </dl>
        {result.reason && <p className="failure-note" data-tone={checkTone[result.status]}>{result.reason}</p>}
        <div className="ticket-actions actions">{result.artifact_refs.filter((id) => /^[A-Za-z0-9._-]+\.(stdout|stderr)$/.test(id) && !id.includes("..")).map((id) => <button type="button" key={id} disabled={busy} onClick={() => onArtifact(id)}>View {id.endsWith(".stdout") ? "stdout" : "stderr"}</button>)}</div>
        <details><summary>Complete check and artifact evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
      </li>)}</ul>
      {boundLog && <details open className="check-log"><summary>Check log · <code>{boundLog.artifactId}</code></summary><pre aria-label="Check log" tabIndex={0}>{boundLog.text || "Empty log."}</pre></details>}
    </details>
    <div className="candidate-verdict" data-tone={review ? verdictTone[review.verdict] : undefined}>
      <h4>Independent review</h4>
      {review ? <>
        <p className="verdict-line">Verdict: <StatusBadge tone={verdictTone[review.verdict]}>{review.verdict.replace(/_/g, " ")}</StatusBadge></p>
        <p>Candidate: <code>{review.candidate_hash}</code></p>
        <p>Reviewer session: <code>{review.reviewer_session}</code></p>
        {review.findings.length > 0 ? <ul className="review-findings record-list" aria-label="Review findings">{review.findings.map((finding, index) => <li key={index} className="record finding-record" data-tone={severityTone[finding.severity]}>
          <StatusBadge tone={severityTone[finding.severity]}>{finding.severity}</StatusBadge> <code>{finding.path}:{finding.line}</code>
          <p>{finding.explanation}</p>
          <ul className="finding-evidence" aria-label="Finding evidence">{finding.evidence.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
        </li>)}</ul> : <p className="empty">No findings recorded.</p>}
        <details><summary>Complete structured review</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      </> : <p className="empty">No independent review recorded for this candidate.</p>}
    </div>
    <small className="candidate-usage">Runtime usage recorded for this candidate: {evidence.elapsed_seconds}s · ${(evidence.cost_usd_micros / 1_000_000).toFixed(4)}. Repairs keep the existing plan approval and produce a new candidate; earlier evidence remains bound to its original hash.</small>
  </section>;
}
