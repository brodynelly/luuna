import { useState } from "react";
import type { ScaffoldProfile, ScaffoldProposal, ScaffoldResult } from "@luuna/api-client";
import { Button, Checkbox, Form, FormFooter, Id, ListGroup, ListRow, options, SelectField, Stack, StatusBadge, StatusLine, submitted, Surface, TextField } from "@luuna/ui";

const PROFILES: readonly ScaffoldProfile[] = ["python", "node", "node-typescript", "react", "nextjs", "rust", "go", "flutter", "android", "ios"];

export interface ScaffoldActions {
  propose: (request: { profile: ScaffoldProfile; name: string; parent_dir: string }) => Promise<ScaffoldProposal | null>;
  confirm: (proposal: ScaffoldProposal) => Promise<ScaffoldResult | null>;
}

/**
 * Creates a new project from a stack profile: a proposal lists every file, the baseline command
 * and what this host lacks, and nothing is written until the developer confirms its exact hash.
 */
export function ScaffoldForm({ disabled, busy, actions }: { disabled: boolean; busy: boolean; actions: ScaffoldActions }) {
  const [profile, setProfile] = useState<ScaffoldProfile>("python");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [proposal, setProposal] = useState<ScaffoldProposal | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<ScaffoldResult | null>(null);

  async function propose() {
    setResult(null);
    setAcknowledged(false);
    const value = await actions.propose({ profile, name: name.trim(), parent_dir: parent.trim() });
    if (value) setProposal(value);
  }

  async function confirm() {
    if (!proposal || !acknowledged) return;
    const created = await actions.confirm(proposal);
    if (!created) return;
    setResult(created);
    setProposal(null);
    setAcknowledged(false);
    setName("");
  }

  const missing = proposal?.required_tools.filter((tool) => tool.status === "missing") ?? [];
  return <>
    <Form onSubmit={submitted(() => void propose())} className="form-group" disabled={disabled}>
      <SelectField label="Stack profile" aria-label="Stack profile" value={profile} onChange={(event) => setProfile(event.target.value as ScaffoldProfile)} options={options(PROFILES)} />
      <TextField label="New project name" value={name} onChange={(event) => setName(event.target.value)} required mono pattern="[a-z][a-z0-9\-]{0,63}" />
      <TextField label="Parent directory" value={parent} onChange={(event) => setParent(event.target.value)} required mono placeholder="/absolute/existing/directory" />
      <FormFooter hint="A proposal lists every file, the baseline command and the tools this host lacks. Nothing is written until you confirm its exact hash.">
        <Button variant="primary" submit disabled={!name.trim() || !parent.trim()} data-capability="projects.scaffold.propose">Propose scaffold</Button>
      </FormFooter>
    </Form>
    {proposal && <Surface level="muted" pad={3} className="scaffold-proposal" aria-label="Scaffold proposal"><Stack gap={2}>
      <StatusLine status={false} className="scaffold-target">
        <strong>{proposal.profile}</strong> in <Id>{proposal.target_dir}</Id> · <StatusBadge tone={proposal.status === "ready" ? "neutral" : "attention"}>{proposal.status}</StatusBadge>
      </StatusLine>
      {proposal.blocked_reason && <StatusLine status={false}>{proposal.blocked_reason}</StatusLine>}
      <ListGroup aria-label="Files the scaffold writes">{proposal.files.map((file) => <ListRow key={file.path} title={<Id>{file.path}</Id>} />)}</ListGroup>
      <StatusLine status={false} className="scaffold-baseline">Baseline: {proposal.baseline.map((check) => <Id key={check.id}>{[check.executable, ...check.args].join(" ")}</Id>)}</StatusLine>
      {missing.length > 0 && <StatusLine status={false}>Missing on this host: {missing.map((tool) => tool.tool).join(", ")}</StatusLine>}
      {proposal.network_steps.length > 0 && <StatusLine status={false}>Network steps you confirm with the hash: {proposal.network_steps.join("; ")}</StatusLine>}
      {proposal.questions.map((question, index) => <StatusLine key={index} status={false}>{question.topic}: {question.detail}</StatusLine>)}
      <StatusLine status={false} className="scaffold-hash">Exact proposal hash: <Id>{proposal.hash}</Id></StatusLine>
      <Checkbox className="acknowledgment" label="I reviewed the files, baseline and hash above" checked={acknowledged} disabled={busy || proposal.status !== "ready"} onChange={(event) => setAcknowledged(event.target.checked)} />
      <Button variant="primary" disabled={busy || proposal.status !== "ready" || !acknowledged} data-capability="projects.scaffold" onClick={() => void confirm()}>
        Create project and run its baseline
      </Button>
    </Stack></Surface>}
    {result && <StatusLine>
      Scaffolded <Id>{result.target_dir}</Id> at commit <Id>{result.commit.slice(0, 12)}</Id>; baseline {result.check.status}
      {result.check.tests_detected !== null ? ` (${result.check.tests_detected} tests detected)` : ""}{result.replayed ? " (replayed)" : ""}.
    </StatusLine>}
  </>;
}
