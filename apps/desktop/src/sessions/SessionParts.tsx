import { useState } from "react";
import { isTerminal, type EventEnvelope, type LuunaClient, type RunRecord } from "@luuna/api-client";
import { canCancel } from "../workflow-state";
import { runTone } from "../design/tone";
import { localTime, runTitle, sessionStatus } from "../shell/runtime";
import { Box, Button, ContextMenuArea, copyText, Disclosure, EmptyState, FieldRow, Form, FormFooter, HeadingRow, Id, Item, List, LiveOutput, Meta, Placeholder, ReasonNote, Section, SelectableCard, StatusBadge, submitted, Tag, TextArea, TextField, Toolbar, useNotify } from "../ui";
import { EventList } from "./EventList";

/** The history rail: every recorded run as a selectable card, newest first, paged by 200. */
export function History({ runs, selected, connected, newer, onSelect, onRefresh, onNewer, onOlder }: {
  runs: RunRecord[]; selected: string | null; connected: boolean; newer: boolean;
  onSelect: (id: string) => void; onRefresh: () => void; onNewer: () => void; onOlder: () => void;
}) {
  const notify = useNotify();
  const refresh = <Button variant="text" disabled={!connected} data-capability="runs.list" onClick={onRefresh}>Refresh</Button>;
  return <Section id="history-heading" title="History" as="aside" className="history" accessory={refresh}>
    {runs.length
      ? <List className="history-list">{runs.map((run) => <Item key={run.id}>
        <ContextMenuArea label={`Actions for ${runTitle(run)}`} commands={() => [
          { label: "Show session", onSelect: () => onSelect(run.id) },
          { label: "Copy run ID", group: true, onSelect: () => void copyText(run.id).then(() => notify("Run ID copied")) },
        ]}>
          <SelectableCard selected={selected === run.id} onSelect={() => onSelect(run.id)} data-capability="runs.show" title={runTitle(run)}
            meta={<><StatusBadge tone={runTone[run.state]}>{run.state}</StatusBadge><time dateTime={run.created_at}>{localTime(run.created_at)}</time></>} />
        </ContextMenuArea>
      </Item>)}</List>
      : <EmptyState>{connected ? "No sessions yet. Start one to create a durable run record." : "Connect to see sessions saved by your runtime."}</EmptyState>}
    {connected && runs.length > 0 && <Toolbar>
      <Button disabled={!newer} onClick={onNewer}>Newer sessions</Button>
      <Button disabled={runs.length < 200} onClick={onOlder}>Older sessions</Button>
    </Toolbar>}
  </Section>;
}

/** Starts a tool-free Pi conversation; repository changes go through a ticket instead. */
export function StartSession({ disabled, onStart }: { disabled: boolean; onStart: (request: { prompt: string; provider?: string; model?: string }, done: () => void) => void }) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const start = () => {
    if (!prompt.trim()) return;
    onStart({ prompt: prompt.trim(), ...(provider.trim() && { provider: provider.trim() }), ...(model.trim() && { model: model.trim() }) }, () => setPrompt(""));
  };
  return <Section id="new-run-heading" title="Start a Pi session" className="start-panel" accessory={<Tag>No repository tools</Tag>}
    description="A conversation only. Changes to a repository go through a ticket in Projects, where plans are approved, checked and reviewed.">
    <Form onSubmit={submitted(start)} disabled={disabled}>
      <TextArea label="Prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Pi a question…" rows={3} maxLength={32000} required />
      <Disclosure summary="Provider and model" section={false} className="model-options">
        <FieldRow className="model-fields">
          <TextField label="Provider" mono value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Runtime default" />
          <TextField label="Model" mono value={model} onChange={(event) => setModel(event.target.value)} placeholder="Runtime default" />
        </FieldRow>
      </Disclosure>
      <FormFooter hint="Uses the runtime’s configured model credentials."><Button variant="primary" submit disabled={!prompt.trim()} data-capability="runs.start">Start session</Button></FormFooter>
    </Form>
  </Section>;
}

/** The selected session: its state, live output and the durable event record. */
export function EventPanel({ client, active, events, output, live, candidateActive, busy, onCancel }: {
  client: LuunaClient | null; active?: RunRecord; events: EventEnvelope[]; output: string; live: string; candidateActive: boolean; busy: boolean; onCancel: () => void;
}) {
  return <Section id="events-heading" title={active ? "Session events" : "Live activity"} className="event-panel" accessory={active && <StatusBadge tone={runTone[active.state]}>{active.state}</StatusBadge>}>
    {active && client ? <>
      <Box className="run-detail meta">
        <Id>{active.id}</Id>
        <span role="status">{sessionStatus(live, active.state)}</span>
        <span>event replay from sequence {events.at(-1)?.sequence ?? 0}</span>
        {canCancel(active.state, candidateActive) && <Button variant="danger" disabled={busy} data-capability="runs.cancel" onClick={onCancel}>Cancel session</Button>}
      </Box>
      {active.state === "failed" && <ReasonNote block tone="danger" reason="This session failed. Open the final events below for the runtime’s recorded reason." />}
      {output && <Box className="assistant-output"><HeadingRow level={4} title="Pi response" /><LiveOutput label="Pi response" live={!isTerminal(active.state)} followKey={output.length}>{output}</LiveOutput></Box>}
      <EventList key={active.id} events={events} client={client} runId={active.id} />
      {!events.length && <EmptyState>Waiting for the runtime’s event record…</EmptyState>}
      <Meta block className="event-caption">Events replay from the last received sequence after an interruption. A completed session is not a validation result.</Meta>
    </> : <Placeholder title="Select a session or start a new one.">Live output and the event record appear here.</Placeholder>}
  </Section>;
}
