import type { PromptRecord, RenderedPrompt } from "@luuna/api-client";
import { Button, CodeBlock, Form, Hint, ListGroup, ListRow, PropertyList, Section, Stack, submitted, TextArea, TextField } from "@luuna/ui";
import type { ComponentsState } from "./useComponents";

/** A rendered prompt: its exact version, body and hash, before the developer selects it. */
export function PromptPreview({ prompt, selected, busy, onSelect }: { prompt: RenderedPrompt; selected: boolean; busy: boolean; onSelect: () => void }) {
  return <Stack gap={3} className="prompt-preview">
    <strong>{prompt.name} · version {prompt.version}</strong>
    <CodeBlock label="Rendered Beacon prompt">{prompt.body}</CodeBlock>
    <PropertyList layout="inline" items={[{ term: "Exact prompt hash", value: prompt.hash, mono: true }]} />
    <Button disabled={busy} aria-pressed={selected} onClick={onSelect}>{selected ? "Remove prompt from next plan" : "Use this prompt in next plan"}</Button>
  </Stack>;
}

/** The project's versioned Beacon prompts: save a version, preview one, select it for the next plan. */
export function BeaconPrompts({ state }: { state: ComponentsState }) {
  const { busy, client, prompts, preview, selectedPrompt } = state;
  return <Section id="prompts-heading" level={4} variant="plain" title="Beacon prompts">
    <Form onSubmit={submitted(state.savePrompt)} disabled={busy || !client}>
      <TextField label="Prompt name" value={state.promptName} onChange={(event) => state.setPromptName(event.target.value)} required maxLength={100} />
      <TextArea label="Prompt body" value={state.promptBody} onChange={(event) => state.setPromptBody(event.target.value)} required rows={5} maxLength={16000} />
      <Hint>Saving an existing name creates its next version after the runtime checks the expected version.</Hint>
      <Button submit disabled={!state.promptName.trim() || !state.promptBody.trim()} data-capability="prompts.create">Save prompt</Button>
    </Form>
    <PromptList prompts={prompts} busy={busy} onPreview={state.previewPrompt} />
    {preview && <PromptPreview prompt={preview} selected={selectedPrompt?.hash === preview.hash} busy={busy} onSelect={() => state.setSelectedPrompt((selected) => selected?.hash === preview.hash ? null : preview)} />}
  </Section>;
}

function PromptList({ prompts, busy, onPreview }: { prompts: PromptRecord[]; busy: boolean; onPreview: (prompt: PromptRecord) => void }) {
  return <ListGroup className="component-records" aria-label="Beacon prompts" data-capability="prompts.list">{prompts.map((prompt) => <ListRow key={prompt.name}
    title={<strong>{prompt.name} · version {prompt.version}</strong>}
    detail={<Button disabled={busy} data-capability="prompts.render" onClick={() => onPreview(prompt)}>Preview prompt</Button>} />)}</ListGroup>;
}
