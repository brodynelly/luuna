import type { BaselineEvidence } from "@luuna/api-client";
import { Button, Callout, Id, Inline, ListGroup, ListRow, Meta, NextStep, ReasonNote, Stack, StatusBadge, baselineTone } from "@luuna/ui";
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
  return <ListGroup className="repository-baselines" aria-label="Baseline per repository">{repositoryIds.map((id) => {
    const record = latest[id];
    const active = running[id];
    return <ListRow key={id} className="repository-baseline" title={<Id>{id}</Id>}
      meta={record && <>manifest r{record.manifest_revision} · commit <Id>{record.identity.commit.slice(0, 12)}</Id></>}
      trailing={record
        ? <StatusBadge tone={baselineTone[record.status]}>{record.status}</StatusBadge>
        : <StatusBadge tone="attention">no baseline</StatusBadge>}
      detail={<Inline gap={2} wrap>
        <Button disabled={busy || !manifestConfirmed || active !== undefined} data-capability="baselines.start" onClick={() => onRun(id)}>
          Run baseline for {id}
        </Button>
        {active && <Button variant="danger" disabled={busy} data-capability="runs.cancel" onClick={() => onCancel(active)}>Cancel baseline for {id}</Button>}
      </Inline>} />;
  })}</ListGroup>;
}

/** Recorded baselines with each recipe's result, the recorded reason and its logs. */
export function BaselineList({ baselines, busy, onLog }: { baselines: BaselineEvidence[]; busy: boolean; onLog: (runId: string, artifactId: string) => void }) {
  if (baselines.length === 0) return null;
  return <ListGroup className="baselines" aria-label="Recorded baselines" data-capability="baselines.list">{baselines.map((baseline) => {
    const tone = baselineTone[baseline.status];
    const step = baseline.reason ? baselineStep(baseline.status, baseline.reason) : "";
    const results = baseline.results.map((result) => `${result.recipe_id}: ${result.status}${result.exit_code === null || result.exit_code === undefined ? "" : ` (exit ${result.exit_code})`}`);
    return <ListRow key={baseline.id} className="baseline-record" leading={<StatusBadge tone={tone}>{baseline.status}</StatusBadge>}
      title={<span className="baseline-summary meta">manifest r{baseline.manifest_revision} · commit <Id>{baseline.identity.commit.slice(0, 12)}</Id> · {baseline.results.length}/{baseline.required_checks.length} required results</span>}
      detail={<Stack gap={2}>
        {baseline.reason && <ReasonNote tone={tone} reason={baseline.reason} next={step && !baseline.prerequisite ? step : undefined} />}
        {baseline.prerequisite && <Callout className="baseline-offer" tone="attention" status>
          Testing setup needed for <Id>{baseline.prerequisite.repository_id}</Id>: {baseline.prerequisite.reason}{" "}
          <NextStep>{baseline.prerequisite.next} The ticket is created from the offer in the workflows below.</NextStep>
        </Callout>}
        <Meta className="baseline-results">{results.join(" · ")}</Meta>
        {baseline.results.length > 0 && <Inline className="baseline-logs" gap={2} wrap>{baseline.results.flatMap((result) => baselineArtifacts(result).map((id) =>
          <Button key={`${result.id}-${id}`} disabled={busy} data-capability="artifacts.read" onClick={() => onLog(baseline.run_id, id)}>
            View {result.recipe_id} {id.endsWith(".stdout") ? "stdout" : "stderr"}
          </Button>))}</Inline>}
      </Stack>} />;
  })}</ListGroup>;
}
