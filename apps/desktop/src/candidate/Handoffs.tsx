import type { SetupHandoff, WorktreeLease } from "@luuna/api-client";
import { Alert, Button, Id, Item, List, ListGroup, ListRow, Meta, NextStep, Stack, Surface, Text } from "@luuna/ui";
import { copyPath } from "./rules";

/** The testing-setup handoff of a setup workflow (ADR 0022 point 6): the proposed checks and the runtime's next step. */
export function SetupHandoffView({ handoff }: { handoff: SetupHandoff }) {
  return <Alert tone="attention" announce="status" className="setup-handoff" aria-label="Testing-setup handoff"><Stack gap="1.5">
    <Text>
      <strong>Testing setup for <Id>{handoff.repository_id}</Id></strong>: {handoff.reviewed ? "the setup candidate is reviewed with a passed verdict." : "the setup candidate is not yet reviewed with a passed verdict."}
      {handoff.candidate_commit && <> Candidate commit <Id>{handoff.candidate_commit}</Id>.</>}
    </Text>
    <Text>Proposed required checks to confirm in the next manifest revision after merging:</Text>
    <List className="handoff-checks" label="Proposed required checks">{handoff.checks.map((check) => <Item key={check.id}>
      <Id>{check.id}</Id>: <Id>{[check.executable, ...check.args].join(" ")}</Id>{check.cwd && check.cwd !== "." ? <> in <Id>{check.cwd}</Id></> : null} · {check.timeout_seconds}s{check.capabilities.length ? ` · ${check.capabilities.join(", ")}` : ""}
    </Item>)}</List>
    <NextStep block>{handoff.next}</NextStep>
  </Stack></Alert>;
}

/** The candidate worktree paths to open in the developer's editor; opening one grants no permission. */
export function EditorHandoff({ worktrees, busy }: { worktrees: WorktreeLease[]; busy: boolean }) {
  return <Surface level="raised" padded className="editor-handoff" data-surface="editor-handoff" role="group" aria-label="Open in your editor"><Stack gap="1.5">
    <Meta>Open the candidate worktree in your editor: the path is Luuna-owned and bound to this run; a manual edit invalidates the affected checks, and opening it grants no permission to run agents outside the approved scope.</Meta>
    <ListGroup className="worktree-paths" aria-label="Candidate worktree paths">{worktrees.map((lease) => <ListRow key={lease.id}
      title={<Id>{lease.repository_id}</Id>}
      meta={<><Id className="worktree-path">{lease.path}</Id> ({lease.state})</>}
      detail={<Button variant="text" disabled={busy} onClick={() => copyPath(lease.path)}>Copy path for {lease.repository_id}</Button>} />)}</ListGroup>
  </Stack></Surface>;
}
