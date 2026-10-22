import type { BaselineEvidence } from "@luuna/api-client";
import { Actions, Button, Callout, Id, Meta, NextStep, ReasonNote, RecordItem, RecordList, StatusBadge } from "../ui";
import { baselineTone } from "../design/tone";
import { baselineStep } from "../failures";
import { baselineArtifacts, latestBaselines } from "./project-model";

/**
 * One baseline control per registered repository with that repository's latest status: a
 * multi-repository feature needs every repository's passing baseline, and one baseline per
 * repository runs at a time.
 */
export function RepositoryBaselines({ repositoryIds, baselines, running, busy, manifestConfirmed, onRun, onCancel }: {
  repositoryIds: string[]; baselines: BaselineEvidence[]; running: Record<string, string | undefined>; busy: boolean; manifestConfirmed: boolean;
  onRun: (repositoryId: string) => void; onCancel: (runId: string) => void;
}) {
  const latest = latestBaselines(baselines, repositoryIds);
  return <RecordList className="repository-baselines" label="Baseline per repository">{repositoryIds.map((id) => {
    const record = latest[id];
    const active = running[id];
    return <RecordItem key={id} className="repository-baseline">
      <Id>{id}</Id>
      {record
        ? <StatusBadge tone={baselineTone[record.status]}>{record.status}</StatusBadge>
        : <StatusBadge tone="attention">no baseline</StatusBadge>}
      {record && <span className="meta">manifest r{record.manifest_revision} · commit <Id>{record.identity.commit.slice(0, 12)}</Id></span>}
      <Button disabled={busy || !manifestConfirmed || active !== undefined} data-capability="baselines.start" onClick={() => onRun(id)}>
        Run baseline for {id}
      </Button>
      {active && <Button variant="danger" disabled={busy} data-capability="runs.cancel" onClick={() => onCancel(active)}>Cancel baseline for {id}</Button>}
    </RecordItem>;
  })}</RecordList>;
}

/** Recorded baselines with each recipe's result, the recorded reason and its logs. */
export function BaselineList({ baselines, busy, onLog }: { baselines: BaselineEvidence[]; busy: boolean; onLog: (runId: string, artifactId: string) => void }) {
  if (baselines.length === 0) return null;
  return <RecordList className="baselines" label="Recorded baselines" data-capability="baselines.list">{baselines.map((baseline) => {
    const tone = baselineTone[baseline.status];
    const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
    const results = baseline.results.map((result) => `${result.recipe_id}: ${result.status}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}`);
    return <RecordItem key={baseline.id} headed className="baseline-record" tone={tone}>
      <StatusBadge tone={tone}>{baseline.status}</StatusBadge>
      <span className="baseline-summary meta">
        manifest r{baseline.manifest_revision} · commit <Id>{baseline.identity.commit.slice(0, 12)}</Id> · {baseline.results.length}/{baseline.required_checks.length} required results
      </span>
      {baseline.reason && <ReasonNote tone={tone} reason={baseline.reason} next={step && !baseline.prerequisite ? step : undefined} />}
      {baseline.prerequisite && <Callout className="baseline-offer" tone="attention" status>
        Testing setup needed for <Id>{baseline.prerequisite.repository_id}</Id>: {baseline.prerequisite.reason}{" "}
        <NextStep>{baseline.prerequisite.next} The ticket is created from the offer in the workflows below.</NextStep>
      </Callout>}
      <Meta className="baseline-results">{results.join(" · ")}</Meta>
      {baseline.results.length > 0 && <Actions className="baseline-logs">{baseline.results.flatMap((result) => baselineArtifacts(result).map((id) =>
        <Button key={`${result.id}-${id}`} disabled={busy} data-capability="artifacts.read" onClick={() => onLog(baseline.run_id, id)}>
          View {result.recipe_id} {id.endsWith(".stdout") ? "stdout" : "stderr"}
        </Button>))}</Actions>}
    </RecordItem>;
  })}</RecordList>;
}
