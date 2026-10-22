import type { CandidateDiff, CandidateEvidence } from "@luuna/api-client";
import { checkTone, severityTone, verdictTone } from "../design/tone";
import { Actions, Box, Button, CodeBlock, Disclosure, EmptyState, Facts, HeadingRow, Id, Item, List, Meta, Output, ReasonNote, RecordItem, RecordList, StatusBadge, Text } from "../ui";
import { viewableArtifact } from "./rules";

type CheckResult = CandidateEvidence["results"][number];
type Review = NonNullable<CandidateEvidence["review"]>;

/** The diff bound to this candidate's hash; an oversized diff lists what it omits instead of claiming no changes. */
export function CandidateDiffView({ diff }: { diff: CandidateDiff }) {
  const body = diff.diff || (diff.truncated ? "Diff omitted because it exceeds the display limit. Inspect the changed files listed below." : "No changes.");
  return <Disclosure open className="candidate-diff" summary={<>Diff for <Id>{diff.candidate_hash}</Id></>}>
    <Meta block className="diff-meta">{diff.repository_id} · base <Id>{diff.base_commit}</Id> · candidate commit <Id>{diff.commit}</Id></Meta>
    <CodeBlock label="Candidate diff">{body}</CodeBlock>
    {diff.truncated && <Text role="status">This diff is truncated. It does not show all candidate changes.</Text>}
    {diff.worktree_drift && <Text role="status">{diff.worktree_drift}</Text>}
    {diff.files && <List label="Changed candidate files">{diff.files.map((file) => <Item key={file.path}><Id>{file.path}</Id> · {file.status} · {file.shown}</Item>)}</List>}
  </Disclosure>;
}

/** One executed check: recipe and badge, the exact command, its identities, reason, logs and the complete record. */
function CheckRecord({ result, busy, onArtifact }: { result: CheckResult; busy: boolean; onArtifact: (id: string) => void }) {
  const facts = [
    { term: "Candidate hash", value: <Id>{result.candidate_hash}</Id> },
    { term: "Commit", value: <Id>{result.commit}</Id> },
    { term: "Environment", value: <Id>{result.environment_fingerprint}</Id> },
    { term: "Exit code", value: result.exit_code ?? "not recorded" },
    ...(result.tests_detected !== undefined ? [{ term: "Tests detected", value: result.tests_detected }] : []),
  ];
  return <RecordItem headed tone={checkTone[result.status]} className="check-record">
    <strong>{result.recipe_id}</strong><StatusBadge tone={checkTone[result.status]}>{result.status}</StatusBadge>
    <Id className="check-command">{result.command.join(" ")}</Id>
    <Facts items={facts} />
    {result.reason && <ReasonNote block tone={checkTone[result.status]} reason={result.reason} />}
    <Actions className="check-actions ticket-actions">{result.artifact_refs.filter(viewableArtifact).map((id) => <Button key={id} disabled={busy} data-capability="artifacts.read" onClick={() => onArtifact(id)}>View {id.endsWith(".stdout") ? "stdout" : "stderr"}</Button>)}</Actions>
    <Disclosure section={false} className="raw-evidence" summary="Complete check and artifact evidence"><Output>{JSON.stringify(result, null, 2)}</Output></Disclosure>
  </RecordItem>;
}

/** Every recorded check result of this candidate, then the opened log when it belongs to this candidate. */
export function CheckEvidence({ evidence, log, busy, onArtifact }: { evidence: CandidateEvidence; log?: { artifactId: string; text: string }; busy: boolean; onArtifact: (id: string) => void }) {
  return <Disclosure className="candidate-checks" open={evidence.results.length > 0} summary={`Check evidence · ${evidence.results.length} recorded result(s)`}>
    {evidence.results.length === 0 && <EmptyState>No check results recorded for this candidate.</EmptyState>}
    <RecordList className="check-results recipes" label="Candidate check results">{evidence.results.map((result) => <CheckRecord key={result.id} result={result} busy={busy} onArtifact={onArtifact} />)}</RecordList>
    {log && <Disclosure open section={false} className="check-log" summary={<>Check log · <Id>{log.artifactId}</Id></>}><CodeBlock label="Check log">{log.text || "Empty log."}</CodeBlock></Disclosure>}
  </Disclosure>;
}

/** One structured finding: severity, exact location, explanation and its evidence. */
function Finding({ finding }: { finding: Review["findings"][number] }) {
  return <RecordItem headed tone={severityTone[finding.severity]} className="finding-record">
    <StatusBadge tone={severityTone[finding.severity]}>{finding.severity}</StatusBadge> <Id>{finding.path}:{finding.line}</Id>
    <Text>{finding.explanation}</Text>
    <List className="finding-evidence" label="Finding evidence">{finding.evidence.map((item, index) => <Item key={index}>{item}</Item>)}</List>
  </RecordItem>;
}

/** The independent review bound to this candidate, or the statement that none is recorded. */
export function ReviewVerdict({ review }: { review?: Review }) {
  return <Box className="candidate-verdict" data-tone={review ? verdictTone[review.verdict] : undefined}>
    <HeadingRow level={4} title="Independent review" />
    {review ? <>
      <Text className="verdict-line">Verdict: <strong><StatusBadge tone={verdictTone[review.verdict]}>{review.verdict.replace(/_/g, " ")}</StatusBadge></strong></Text>
      <Meta block>Candidate: <Id>{review.candidate_hash}</Id></Meta>
      <Meta block>Reviewer session: <Id>{review.reviewer_session}</Id></Meta>
      {review.findings.length > 0
        ? <RecordList className="review-findings" label="Review findings">{review.findings.map((finding, index) => <Finding key={index} finding={finding} />)}</RecordList>
        : <EmptyState>No findings recorded.</EmptyState>}
      <Disclosure section={false} className="raw-evidence" summary="Complete structured review"><Output>{JSON.stringify(review, null, 2)}</Output></Disclosure>
    </> : <EmptyState>No independent review recorded for this candidate.</EmptyState>}
  </Box>;
}
