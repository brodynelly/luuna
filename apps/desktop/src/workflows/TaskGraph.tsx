import type { DependencyOverride, RunRecord, TaskRecord } from "@luuna/api-client";
import { Alert, Button, Hint, Id, Inline, ListGroup, ListRow, Meta, Stack } from "@luuna/ui";
import { stateText, taskResumable } from "./model";

type AdvisoryResult = NonNullable<TaskRecord["advisory_result"]>;

/** An advisory task's findings, proposed tasks and risks; a proposal becomes real only through a plan you approve. */
function AdvisoryResultView({ task, result, busy, onDerive }: { task: TaskRecord; result: AdvisoryResult; busy: boolean; onDerive?: (task: TaskRecord) => void }) {
  return <Alert tone="neutral" announce="status" className="advisory-result" aria-label={`Advisory result of ${task.task_id}`}>
    <Stack gap="1.5">
      <Meta>Advisory result: {result.findings.length} finding(s), {result.proposed_tasks.length} proposed task(s), {result.risks.length} risk(s). A proposed task becomes real only through a plan revision you create and approve.</Meta>
      {result.findings.length > 0 && <ListGroup aria-label="Findings">{result.findings.map((finding, index) => <ListRow key={index} title={finding} />)}</ListGroup>}
      {result.proposed_tasks.length > 0 && <ListGroup aria-label="Proposed tasks">{result.proposed_tasks.map((proposed) => <ListRow key={proposed.id} title={<>
        <Id>{proposed.id}</Id> ({proposed.repository_id}, {stateText(String(proposed.role ?? "implementer"))})
        {proposed.depends_on?.length ? ` · after ${proposed.depends_on.join(", ")}` : ""}
        {proposed.paths?.length ? ` · paths ${proposed.paths.join(", ")}` : ""}
        {proposed.rationale ? ` · ${proposed.rationale}` : ""}
      </>} />)}</ListGroup>}
      {result.risks.length > 0 && <ListGroup aria-label="Risks">{result.risks.map((risk, index) => <ListRow key={index} title={risk} />)}</ListGroup>}
      {onDerive && result.proposed_tasks.length > 0 && <Inline wrap gap={2}>
        <Button disabled={busy} onClick={() => onDerive(task)}>Derive plan from this proposal</Button>
        <Hint>Pre-fills the next plan revision's tasks with this proposal, each deriving from <Id>{task.task_id}</Id>; you edit, create and approve it like any plan.</Hint>
      </Inline>}
    </Stack>
  </Alert>;
}

/** The trace lines of one task: who assigned it, what it derives from and the overrides that name it. */
function TaskTraces({ task, named }: { task: TaskRecord; named: DependencyOverride[] }) {
  const trace = task.assigned_by;
  return <>
    {trace && <Meta className="task-trace" label={`Assignment trace of ${task.task_id}`}>
      assigned by {trace.approved_by} · approval <Id>{trace.approval_id}</Id> at {trace.approved_at} · plan <Id>{trace.plan_id}</Id> r{trace.plan_revision} · <Id>{trace.plan_hash}</Id>
    </Meta>}
    {task.derived_from_task && <Meta className="task-trace">derived from advisory task <Id>{task.derived_from_task}</Id></Meta>}
    {named.length > 0 && <Meta className="task-trace">dependency overrides: {named.map((override, index) => <span key={index}>
      {index > 0 && "; "}{override.action} <Id>{override.consumer}</Id> ← <Id>{override.producer}</Id> ({override.justification})
    </span>)}</Meta>}
  </>;
}

/**
 * The durable task graph of a workflow with a state-specific control: a failed, blocked or
 * interrupted task of a settled (failed or interrupted) graph resumes by `task_id` under the
 * original approval, keeping completed tasks' commits and worktrees (ADR 0017 point 8). The
 * runtime re-checks the approval, the budgets and every binding before anything runs.
 */
export function TaskGraph({ run, tasks, overrides = [], busy, onResume, onDerive }: { run: RunRecord; tasks: TaskRecord[]; overrides?: DependencyOverride[]; busy: boolean; onResume: (taskId: string) => void; onDerive?: (task: TaskRecord) => void }) {
  return <ListGroup className="task-graph" aria-label="Task graph">{tasks.map((task) => {
    const named = task.dependency_overrides ?? overrides.filter((override) => override.consumer === task.task_id || override.producer === task.task_id);
    const result = task.advisory_result ?? undefined;
    return <ListRow key={task.task_id} title={<Inline as="span" wrap gap={2}>
      <Id>{task.task_id}</Id> ({task.repository_id}) · role {stateText(String(task.role ?? "implementer"))} · {task.state}
      {task.depends_on.length ? ` · after ${task.depends_on.join(", ")}` : ""}
      {task.candidate_commit ? ` · commit ${task.candidate_commit.slice(0, 12)}` : ""}
      {task.reason ? ` · ${task.reason}` : ""}
    </Inline>} detail={<Stack gap={1}>
      {taskResumable(run, task) && <Inline><Button disabled={busy} data-capability="runs.implement" onClick={() => onResume(task.task_id)}>Resume task {task.task_id}</Button></Inline>}
      <TaskTraces task={task} named={named} />
      {result && <AdvisoryResultView task={task} result={result} busy={busy} onDerive={onDerive} />}
    </Stack>} />;
  })}</ListGroup>;
}
