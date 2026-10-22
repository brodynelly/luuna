import type { ReactNode } from "react";
import type { SetupHandoff, WorktreeLease } from "@luuna/api-client";
import type { Tone } from "../design/tone";
import { Box, Button, CalloutBlock, Id, Item, List, Meta, NextStep, Text } from "../ui";
import { copyPath } from "./rules";


/** The testing-setup handoff of a setup workflow (ADR 0022 point 6): the proposed checks and the runtime's next step. */
export function SetupHandoffView({ handoff }: { handoff: SetupHandoff }) {
  return <CalloutBlock tone="attention" className="setup-handoff" label="Testing-setup handoff">
    <Text>
      <strong>Testing setup for <Id>{handoff.repository_id}</Id></strong>: {handoff.reviewed ? "the setup candidate is reviewed with a passed verdict." : "the setup candidate is not yet reviewed with a passed verdict."}
      {handoff.candidate_commit && <> Candidate commit <Id>{handoff.candidate_commit}</Id>.</>}
    </Text>
    <Text>Proposed required checks to confirm in the next manifest revision after merging:</Text>
    <List className="handoff-checks" label="Proposed required checks">{handoff.checks.map((check) => <Item key={check.id}>
      <Id>{check.id}</Id>: <Id>{[check.executable, ...check.args].join(" ")}</Id>{check.cwd && check.cwd !== "." ? <> in <Id>{check.cwd}</Id></> : null} · {check.timeout_seconds}s{check.capabilities.length ? ` · ${check.capabilities.join(", ")}` : ""}
    </Item>)}</List>
    <NextStep block>{handoff.next}</NextStep>
  </CalloutBlock>;
}

/** The candidate worktree paths to open in the developer's editor; opening one grants no permission. */
export function EditorHandoff({ worktrees, busy }: { worktrees: WorktreeLease[]; busy: boolean }) {
  return <Box className="editor-handoff" data-surface="editor-handoff" role="group" aria-label="Open in your editor">
    <Meta>Open the candidate worktree in your editor: the path is Luuna-owned and bound to this run; a manual edit invalidates the affected checks, and opening it grants no permission to run agents outside the approved scope.</Meta>
    <List className="worktree-paths" label="Candidate worktree paths">{worktrees.map((lease) => <Item key={lease.id}>
      <Id>{lease.repository_id}</Id> <Id className="worktree-path">{lease.path}</Id> ({lease.state}) <Button variant="text" disabled={busy} onClick={() => copyPath(lease.path)}>Copy path for {lease.repository_id}</Button>
    </Item>)}</List>
  </Box>;
}
