import type { CandidateDiff, CandidateView, PublicationRecord, RunRecord, SetupHandoff, WorktreeLease } from "@luuna/api-client";
import { allowedActions, canCancel, canRepair, canRevalidate, canValidate, usageSummary, validationRefusal } from "../workflow-state";
import { nextStep } from "../failures";
import { candidateTone, Actions, Alert, Button, Meta, NextStep, PropertyList, ReasonNote, Section, StatusBadge } from "@luuna/ui";
import { canPublish, canRepairPublication } from "./rules";
import { PublicationSummary } from "./Publication";
import { EditorHandoff, SetupHandoffView } from "./Handoffs";
import { CandidateDiffView, CheckEvidence, ReviewVerdict } from "./Evidence";

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

/** What the runtime is doing for an active candidate, in words. */
function activity(run: RunRecord, status: string): string {
  if (run.state === "implementing") return "running the scoped writer repair";
  return status === "reviewing" ? "running the independent reviewer" : "executing the approved checks";
}

/** The candidate's controls; each appears only when the runtime's state allows it. */
function CandidateActions({ run, view, busy, publication, onValidate, onRepair, onCancel, onDiff, onPublish, onPublication, onReconcilePublication, onRepairPublication }: Props) {
  const evidence = view.evidence!;
  const hash = evidence.candidate.hash;
  const reconcilable = publication && publication.candidate_hash === hash && publication.publication_state === "failed" && !publication.active;
  return <Actions className="ticket-actions">
    <Button disabled={busy} data-capability="runs.diff" onClick={onDiff}>Inspect candidate diff</Button>
    {canValidate(run, view) && <Button variant="primary" disabled={busy} data-capability="runs.validate" onClick={onValidate}>{canRevalidate(run, view) ? "Re-validate and review" : "Validate and review"}</Button>}
    {canRepair(view) && <Button disabled={busy} data-capability="runs.repair" onClick={onRepair}>Repair candidate</Button>}
    {canCancel(run.state, view.active) && <Button variant="danger" disabled={busy} data-capability="runs.cancel" onClick={onCancel}>Cancel workflow</Button>}
    {onPublish && canPublish(run, view, publication) && <Button disabled={busy} data-capability="runs.publish" onClick={onPublish}>Publish: push and open pull requests</Button>}
    {onPublication && evidence.status === "reviewed" && <Button variant="text" disabled={busy} data-capability="runs.publication" onClick={onPublication}>Show publication</Button>}
    {onReconcilePublication && reconcilable && <Button disabled={busy} data-capability="runs.publication.reconcile" onClick={onReconcilePublication}>Reconcile publication</Button>}
    {onRepairPublication && canRepairPublication(run, view, publication) && <Button disabled={busy} data-capability="runs.publication.repair" onClick={onRepairPublication}>Repair after CI failure</Button>}
  </Actions>;
}

/** Displays durable runtime evidence; worker prose never decides these controls. */
export function CandidateReview(props: Props) {
  const { run, view, diff, log, busy, onArtifact, publication, handoff, worktrees = [] } = props;
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
  const revalidate = canRevalidate(run, view);
  const identities = [
    { term: "Candidate hash", value: candidate.hash, mono: true },
    { term: "Approved plan hash", value: candidate.plan_hash, mono: true },
    ...Object.entries(candidate.repository_commits).map(([id, commit]) => ({ key: id, term: `${id} commit`, value: commit, mono: true })),
    ...Object.entries(evidence.repository_trees).map(([id, tree]) => ({ key: `${id}-tree`, term: `${id} tree`, value: tree, mono: true })),
  ];
  const badge = <span className="candidate-heading"><StatusBadge tone={candidateTone[evidence.status]}>{evidence.status.replace(/_/g, " ")}</StatusBadge></span>;
  return <Section id={`candidate-${run.id}-r${candidate.revision}`} level={4} variant="subpanel" className="candidate-review" title={`Candidate r${candidate.revision}`} accessory={badge}>
    <PropertyList layout="inline" items={identities} />
    <CandidateActions {...props} />
    {publication && publication.candidate_hash === candidate.hash && <PublicationSummary publication={publication} />}
    {handoff && <SetupHandoffView handoff={handoff} />}
    {worktrees.length > 0 && <EditorHandoff worktrees={worktrees} busy={busy} />}
    {view.active && <Alert tone="active" announce="status">The runtime is {activity(run, evidence.status)}. Closing this view does not cancel the workflow.</Alert>}
    {evidence.reason && <ReasonNote block tone={candidateTone[evidence.status]} reason={evidence.reason} />}
    {evidence.reason && !revalidate && !view.active && step && <NextStep block>{step}</NextStep>}
    {refusal && <NextStep block>{refusal}</NextStep>}
    {revalidate && <NextStep block>Required checks passed in validation generation {evidence.validation_generation} but no review verdict was recorded. Re-validation starts a fresh generation for this same candidate revision under the existing approval and budgets: the checks run again and a fresh reviewer session is started. No writer attempt is spent.</NextStep>}
    {boundDiff && <CandidateDiffView diff={boundDiff} />}
    <CheckEvidence evidence={evidence} log={boundLog} busy={busy} onArtifact={onArtifact} />
    <ReviewVerdict review={review} />
    <Meta className="candidate-usage" data-capability="runs.candidate">
      {view.usage ? usageSummary(view.usage) : <>Runtime usage recorded for this candidate: {evidence.elapsed_seconds}s · ${(evidence.cost_usd_micros / 1_000_000).toFixed(4)}.</>} Repairs keep the existing plan approval and produce a new candidate; earlier evidence remains bound to its original hash.
    </Meta>
  </Section>;
}
