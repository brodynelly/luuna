import type { CandidateDiff, CandidateView, PublicationRecord, RunRecord, SetupHandoff, WorktreeLease } from "@luuna/api-client";
import { allowedActions, canCancel, canRepair, canRevalidate, canValidate, usageSummary, validationRefusal } from "./workflow-state";
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
  publication?: PublicationRecord;
  onPublish?: () => void;
  onPublication?: () => void;
  onReconcilePublication?: () => void;
  onRepairPublication?: () => void;
  /** The testing-setup handoff of a setup workflow (ADR 0022 point 6), as the candidate view carries it. */
  handoff?: SetupHandoff;
  /** This workflow's worktree leases: the candidate worktree path to open in the developer's editor. */
  worktrees?: WorktreeLease[];
}

/** Copies a worktree path for the developer's editor; opening it transfers no permission (docs/09-experience.md). */
export function copyPath(path: string): void {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard) void clipboard.writeText(path).catch(() => undefined);
}

/** A published candidate whose pull request failed CI on at least one repository may be sent to a bounded repair (the runtime re-observes CI and re-checks every repair gate); a superseded or still-active record never offers it. */
export function canRepairPublication(run: RunRecord, view: CandidateView, publication?: PublicationRecord): boolean {
  const evidence = view.evidence;
  if (!evidence || !publication || view.active || publication.active) return false;
  if (publication.candidate_hash !== evidence.candidate.hash || publication.superseded_by_repair) return false;
  if (evidence.status !== "reviewed" || run.state !== "reviewed" || publication.publication_state !== "pr_open") return false;
  return Object.values(publication.repositories).some((repository) => repository.ci.state === "failure");
}

/** A reviewed candidate with a passed review and no publication in flight may be published; the runtime re-checks every gate. */
export function canPublish(run: RunRecord, view: CandidateView, publication?: PublicationRecord): boolean {
  const evidence = view.evidence;
  if (!evidence || evidence.status !== "reviewed" || view.active || run.state !== "reviewed") return false;
  if (evidence.review?.candidate_hash !== evidence.candidate.hash || evidence.review.verdict !== "passed") return false;
  return !publication || publication.candidate_hash !== evidence.candidate.hash;
}

/** The durable publication record: branches, pull requests, observed CI and merge state. Luuna never merges. */
export function PublicationSummary({ publication }: { publication: PublicationRecord }) {
  return <div className="publication subpanel" aria-label="Publication record" data-tone={publication.publication_state === "integrated" ? "success" : publication.publication_state === "failed" ? "danger" : publication.active ? "active" : "neutral"}>
    <p><strong>Publication</strong> <StatusBadge tone={publication.publication_state === "integrated" ? "success" : publication.publication_state === "failed" ? "danger" : publication.active ? "active" : "neutral"}>{publication.publication_state}</StatusBadge>{publication.active && <small> in progress</small>}</p>
    {publication.reason && <p className="failure-note" data-tone="danger">{publication.reason}</p>}
    {publication.superseded_by_repair && <p className="recovery-note" role="status">Superseded: this publication's candidate was sent to a bounded repair after its pull request failed CI. The pull request stays yours to close; the repaired candidate publishes under a new branch whose pull request names this one.{publication.superseded_reason ? ` ${publication.superseded_reason}` : ""}</p>}
    <ul className="record-list" aria-label="Published repositories">{Object.entries(publication.repositories).map(([id, repository]) => <li key={id}>
      <strong>{id}</strong> · branch <code>{repository.branch}</code> at <code>{repository.commit.slice(0, 12)}</code> · push {repository.push} · pull request {repository.pull_request ? <a href={repository.pull_request.url} target="_blank" rel="noreferrer">#{repository.pull_request.number}</a> : repository.pull_request_step}
      <small> · CI {repository.ci.state}{repository.ci.reason ? ` (${repository.ci.reason})` : ""} · {repository.merge.merged ? `merged${repository.merge.merged_by ? ` by ${repository.merge.merged_by}` : ""}` : "not merged; merging stays with you on GitHub"}</small>
      {repository.reason && <small className="failure-note" data-tone="danger"> · {repository.reason}</small>}
    </li>)}</ul>
  </div>;
}

/** Displays durable runtime evidence; worker prose never decides these controls. */
export function CandidateReview({ run, view, diff, log, busy, onValidate, onRepair, onCancel, onDiff, onArtifact, publication, onPublish, onPublication, onReconcilePublication, onRepairPublication, handoff, worktrees = [] }: Props) {
  const evidence = view.evidence;
  if (!evidence) return null;
  const candidate = evidence.candidate;
  const boundDiff = diff?.candidate_hash === candidate.hash ? diff : undefined;
  const boundLog = log?.candidateHash === candidate.hash && evidence.results.some((result) => result.artifact_refs.includes(log.artifactId)) ? log : undefined;
  const review = evidence.review?.candidate_hash === candidate.hash ? evidence.review : undefined;
  // The next step never recommends an action the runtime refuses; it names the refusal instead.
  const step = evidence.reason ? nextStep(evidence.reason, allowedActions(run, view)) : "";
  // A pending candidate has no reason of its own, so a refused validation says why here.
  const refusal = step.startsWith("Validation is not available") ? "" : validationRefusal(run, view);
  return <section className="candidate-review subpanel" aria-label={`Candidate revision ${candidate.revision}`} data-capability="runs.candidate">
    <div className="candidate-heading"><strong>Candidate r{candidate.revision}</strong><StatusBadge tone={candidateTone[evidence.status]}>{evidence.status.replace(/_/g, " ")}</StatusBadge></div>
    <dl className="facts">
      <div><dt>Candidate hash</dt><dd><code>{candidate.hash}</code></dd></div>
      <div><dt>Approved plan hash</dt><dd><code>{candidate.plan_hash}</code></dd></div>
      {Object.entries(candidate.repository_commits).map(([id, commit]) => <div key={id}><dt>{id} commit</dt><dd><code>{commit}</code></dd></div>)}
      {Object.entries(evidence.repository_trees).map(([id, tree]) => <div key={`${id}-tree`}><dt>{id} tree</dt><dd><code>{tree}</code></dd></div>)}
    </dl>
    <div className="ticket-actions actions">
      <button type="button" disabled={busy} data-capability="runs.diff" onClick={onDiff}>Inspect candidate diff</button>
      {canValidate(run, view) && <button type="button" className="primary" disabled={busy} data-capability="runs.validate" onClick={onValidate}>{canRevalidate(run, view) ? "Re-validate and review" : "Validate and review"}</button>}
      {canRepair(view) && <button type="button" disabled={busy} data-capability="runs.repair" onClick={onRepair}>Repair candidate</button>}
      {canCancel(run.state, view.active) && <button type="button" className="danger" disabled={busy} data-capability="runs.cancel" onClick={onCancel}>Cancel workflow</button>}
      {onPublish && canPublish(run, view, publication) && <button type="button" disabled={busy} data-capability="runs.publish" onClick={onPublish}>Publish: push and open pull requests</button>}
      {onPublication && evidence.status === "reviewed" && <button type="button" className="text-button" disabled={busy} data-capability="runs.publication" onClick={onPublication}>Show publication</button>}
      {onReconcilePublication && publication && publication.candidate_hash === candidate.hash && publication.publication_state === "failed" && !publication.active && <button type="button" disabled={busy} data-capability="runs.publication.reconcile" onClick={onReconcilePublication}>Reconcile publication</button>}
      {onRepairPublication && canRepairPublication(run, view, publication) && <button type="button" disabled={busy} data-capability="runs.publication.repair" onClick={onRepairPublication}>Repair after CI failure</button>}
    </div>
    {publication && publication.candidate_hash === candidate.hash && <PublicationSummary publication={publication} />}
    {handoff && <div className="setup-handoff callout" data-tone="attention" role="status" aria-label="Testing-setup handoff">
      <p><strong>Testing setup for <code>{handoff.repository_id}</code></strong>: {handoff.reviewed ? "the setup candidate is reviewed with a passed verdict." : "the setup candidate is not yet reviewed with a passed verdict."}{handoff.candidate_commit && <> Candidate commit <code>{handoff.candidate_commit}</code>.</>}</p>
      <p>Proposed required checks to confirm in the next manifest revision after merging:</p>
      <ul className="handoff-checks" aria-label="Proposed required checks">{handoff.checks.map((check) => <li key={check.id}><code>{check.id}</code>: <code>{[check.executable, ...check.args].join(" ")}</code>{check.cwd && check.cwd !== "." ? <> in <code>{check.cwd}</code></> : null} · {check.timeout_seconds}s{check.capabilities.length ? ` · ${check.capabilities.join(", ")}` : ""}</li>)}</ul>
      <p className="recovery-note">{handoff.next}</p>
    </div>}
    {worktrees.length > 0 && <div className="editor-handoff" data-surface="editor-handoff" role="group" aria-label="Open in your editor">
      <small className="meta">Open the candidate worktree in your editor: the path is Luuna-owned and bound to this run; a manual edit invalidates the affected checks, and opening it grants no permission to run agents outside the approved scope.</small>
      <ul className="worktree-paths" aria-label="Candidate worktree paths">{worktrees.map((lease) => <li key={lease.id}><code>{lease.repository_id}</code> <code className="worktree-path">{lease.path}</code> ({lease.state}) <button type="button" className="text-button" disabled={busy} onClick={() => copyPath(lease.path)}>Copy path for {lease.repository_id}</button></li>)}</ul>
    </div>}
    {view.active && <p className="callout" data-tone="active" role="status">The runtime is {run.state === "implementing" ? "running the scoped writer repair" : evidence.status === "reviewing" ? "running the independent reviewer" : "executing the approved checks"}. Closing this view does not cancel the workflow.</p>}
    {evidence.reason && <p className="failure-note" data-tone={candidateTone[evidence.status]}>{evidence.reason}</p>}
    {evidence.reason && !canRevalidate(run, view) && !view.active && step && <p className="recovery-note">{step}</p>}
    {refusal && <p className="recovery-note">{refusal}</p>}
    {canRevalidate(run, view) && <p className="recovery-note">Required checks passed in validation generation {evidence.validation_generation} but no review verdict was recorded. Re-validation starts a fresh generation for this same candidate revision under the existing approval and budgets: the checks run again and a fresh reviewer session is started. No writer attempt is spent.</p>}
    {boundDiff && <details open className="candidate-diff section"><summary>Diff for <code>{boundDiff.candidate_hash}</code></summary><p className="diff-meta meta">{boundDiff.repository_id} · base <code>{boundDiff.base_commit}</code> · candidate commit <code>{boundDiff.commit}</code></p><pre aria-label="Candidate diff" tabIndex={0}>{boundDiff.diff || (boundDiff.truncated ? "Diff omitted because it exceeds the display limit. Inspect the changed files listed below." : "No changes.")}</pre>{boundDiff.truncated && <p role="status">This diff is truncated. It does not show all candidate changes.</p>}{boundDiff.worktree_drift && <p role="status">{boundDiff.worktree_drift}</p>}{boundDiff.files && <ul aria-label="Changed candidate files">{boundDiff.files.map((file) => <li key={file.path}><code>{file.path}</code> · {file.status} · {file.shown}</li>)}</ul>}</details>}
    <details className="candidate-checks section" open={evidence.results.length > 0}>
      <summary>Check evidence · {evidence.results.length} recorded result(s)</summary>
      {evidence.results.length === 0 && <p className="empty">No check results recorded for this candidate.</p>}
      <ul className="check-results recipes record-list" aria-label="Candidate check results">{evidence.results.map((result) => <li key={result.id} className="record record-headed check-record" data-tone={checkTone[result.status]}>
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
        <div className="check-actions ticket-actions actions">{result.artifact_refs.filter((id) => /^[A-Za-z0-9._-]+\.(stdout|stderr)$/.test(id) && !id.includes("..")).map((id) => <button type="button" key={id} disabled={busy} data-capability="artifacts.read" onClick={() => onArtifact(id)}>View {id.endsWith(".stdout") ? "stdout" : "stderr"}</button>)}</div>
        <details className="raw-evidence"><summary>Complete check and artifact evidence</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
      </li>)}</ul>
      {boundLog && <details open className="check-log"><summary>Check log · <code>{boundLog.artifactId}</code></summary><pre aria-label="Check log" tabIndex={0}>{boundLog.text || "Empty log."}</pre></details>}
    </details>
    <div className="candidate-verdict" data-tone={review ? verdictTone[review.verdict] : undefined}>
      <h4>Independent review</h4>
      {review ? <>
        <p className="verdict-line">Verdict: <strong><StatusBadge tone={verdictTone[review.verdict]}>{review.verdict.replace(/_/g, " ")}</StatusBadge></strong></p>
        <p className="meta">Candidate: <code>{review.candidate_hash}</code></p>
        <p className="meta">Reviewer session: <code>{review.reviewer_session}</code></p>
        {review.findings.length > 0 ? <ul className="review-findings record-list" aria-label="Review findings">{review.findings.map((finding, index) => <li key={index} className="record record-headed finding-record" data-tone={severityTone[finding.severity]}>
          <StatusBadge tone={severityTone[finding.severity]}>{finding.severity}</StatusBadge> <code>{finding.path}:{finding.line}</code>
          <p>{finding.explanation}</p>
          <ul className="finding-evidence" aria-label="Finding evidence">{finding.evidence.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
        </li>)}</ul> : <p className="empty">No findings recorded.</p>}
        <details className="raw-evidence"><summary>Complete structured review</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
      </> : <p className="empty">No independent review recorded for this candidate.</p>}
    </div>
    <small className="candidate-usage meta">{view.usage ? usageSummary(view.usage) : <>Runtime usage recorded for this candidate: {evidence.elapsed_seconds}s · ${(evidence.cost_usd_micros / 1_000_000).toFixed(4)}.</>} Repairs keep the existing plan approval and produce a new candidate; earlier evidence remains bound to its original hash.</small>
  </section>;
}
