import type { OrbitExecution, OrbitResult } from "@luuna/api-client";
import { orbitTone } from "@luuna/ui";
import { Callout, CodeBlock, Id, Meta, ReasonNote, RecordItem, RecordList, StatusBadge, Tag } from "@luuna/ui";

function ResultRecord({ result }: { result: OrbitResult }) {
  const tone = orbitTone[result.status];
  return <RecordItem headed className="orbit-result" tone={tone}>
    <Id>{result.repository_id}</Id>
    <StatusBadge tone={tone}>{result.status}</StatusBadge>
    <Meta className="orbit-result-meta">
      {result.action && <><Tag>{result.action}</Tag>{" "}</>}
      {result.command.length > 0 && <Id>{result.command.join(" ")}</Id>}
      {result.exit_code !== null && <> · exit {result.exit_code}</>}
    </Meta>
    {result.reason && <ReasonNote tone={tone === "danger" ? "danger" : undefined} reason={result.reason} />}
    {result.stdout_excerpt && <CodeBlock label={`stdout of ${result.repository_id}`} className="orbit-output">{result.stdout_excerpt}</CodeBlock>}
    {result.stderr_excerpt && <CodeBlock label={`stderr of ${result.repository_id}`} className="orbit-output">{result.stderr_excerpt}</CodeBlock>}
  </RecordItem>;
}

/**
 * The latest execution, per repository: its outcome word, the command, the exit code, the reason
 * and the last 4 KiB of each stream. A succeeded command is neutral: these are the developer's
 * commands, not checks, and only passed evidence is green (ADR 0013, ADR 0036).
 */
export function OrbitResults({ execution }: { execution: OrbitExecution }) {
  return <>
    <Callout className="orbit-not-evidence">Not evidence: these are your commands, not checks. They satisfy no baseline, validation or publication gate.</Callout>
    <Meta block>
      {execution.command.length > 0 && <><Id>{execution.command.join(" ")}</Id> · </>}started <time dateTime={execution.started_at}>{execution.started_at}</time> · finished <time dateTime={execution.finished_at}>{execution.finished_at}</time>
    </Meta>
    <RecordList label="Result per repository" className="orbit-results">{execution.results.map((result) => <ResultRecord key={result.repository_id} result={result} />)}</RecordList>
  </>;
}
