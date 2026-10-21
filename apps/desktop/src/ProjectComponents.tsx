import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ComponentContext, ComponentStatus, LuunaClient, MemoryRecord, MemoryScope, PromptRecord, RenderedPrompt } from "@luuna/api-client";
import { ApiError } from "@luuna/api-client";
import { actionFailure } from "./failures";

interface Props {
  client: LuunaClient | null;
  projectId: string;
  connectionEpoch?: number;
  onContextChange: (context: ComponentContext) => void;
  onStatusChange: (status: ComponentStatus) => void;
  onChanged: () => void;
}

/** Keeps retry delivery identity stable until the form content changes or succeeds. */
export function retryIdentity(previous: { content: string; key: string } | null, content: string, create: () => string = () => crypto.randomUUID()) {
  return previous?.content === content ? previous : { content, key: create() };
}

type PromptDelivery = { content: string; key: string; expectedVersion: number; refused?: boolean };

export function promptRetryIdentity(previous: PromptDelivery | null, content: string, expectedVersion: number, create: () => string = () => crypto.randomUUID()): PromptDelivery {
  return previous?.content === content ? previous : { ...retryIdentity(null, content, create), expectedVersion };
}

export function promptDeliveryAfterPreview(previous: PromptDelivery | null, currentVersion: number) {
  return previous?.refused && previous.expectedVersion !== currentVersion ? null : previous;
}

export function promptEditBody(body: string) {
  const prefix = "## guidance\n";
  return body.startsWith(prefix) && body.endsWith("\n") ? body.slice(prefix.length, -1) : body;
}

export function MemorySelection({ records, selected, busy, onToggle, onDelete }: {
  records: MemoryRecord[]; selected: string[]; busy: boolean;
  onToggle: (record: MemoryRecord) => void; onDelete: (record: MemoryRecord) => void;
}) {
  return <ul className="component-records" aria-label="Atlas memory records">{records.map((record) => <li key={record.id}>
    <label className="component-selection"><input type="checkbox" checked={selected.includes(record.id)} disabled={busy} onChange={() => onToggle(record)} /> Include this memory in the next plan</label>
    <p>{record.content}</p>
    <small>{record.scope === "user" ? "Private user memory" : `${record.scope} memory`} · provenance: {record.provenance}</small>
    <div className="component-record-meta"><code>{record.id}</code><button type="button" className="text-button" disabled={busy} onClick={() => onDelete(record)}>Delete memory</button></div>
  </li>)}</ul>;
}

export function PromptPreview({ prompt, selected, busy, onSelect }: {
  prompt: RenderedPrompt; selected: boolean; busy: boolean; onSelect: () => void;
}) {
  return <div className="prompt-preview">
    <strong>{prompt.name} · version {prompt.version}</strong>
    <pre aria-label="Rendered Beacon prompt" tabIndex={0}>{prompt.body}</pre>
    <small>Exact prompt hash: <code>{prompt.hash}</code></small>
    <button type="button" disabled={busy} aria-pressed={selected} onClick={onSelect}>{selected ? "Remove prompt from next plan" : "Use this prompt in next plan"}</button>
  </div>;
}

/** The runtime owns component storage, authority and resource identity. */
export function ProjectComponents({ client, projectId, connectionEpoch = 0, onContextChange, onStatusChange, onChanged }: Props) {
  const [status, setStatus] = useState<ComponentStatus | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<RenderedPrompt | null>(null);
  const [preview, setPreview] = useState<RenderedPrompt | null>(null);
  const [scope, setScope] = useState<MemoryScope>("project");
  const [content, setContent] = useState("");
  const [provenance, setProvenance] = useState("");
  const [includeUser, setIncludeUser] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [promptName, setPromptName] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const memoryDelivery = useRef<{ content: string; key: string } | null>(null);
  const promptDelivery = useRef<PromptDelivery | null>(null);
  const userMemoryIds = useRef(new Set<string>());

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    onContextChange({ memory_ids: selectedMemory, prompt: selectedPrompt ? { name: selectedPrompt.name, version: selectedPrompt.version, hash: selectedPrompt.hash } : null });
  }, [selectedMemory, selectedPrompt, onContextChange]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setLoading(true);
    client.components(projectId, controller.signal).then(async (next) => {
      if (controller.signal.aborted) return;
      setStatus(next);
      onStatusChange(next);
      setError("");
      if (!next.enabled) {
        setRecords([]); setPrompts([]); setSelectedMemory([]); setSelectedPrompt(null); setPreview(null);
        return;
      }
      const [memory, promptList] = await Promise.all([
        client.listMemory(projectId, { query: appliedQuery, includeUser }, controller.signal),
        client.listPrompts(projectId, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setRecords(memory);
      for (const record of memory) if (record.scope === "user") userMemoryIds.current.add(record.id);
      setPrompts(promptList);
      if (!appliedQuery) setSelectedMemory((ids) => ids.filter((id) => memory.some((record) => record.id === id)));
      setSelectedPrompt((selected) => selected && promptList.some((prompt) => prompt.name === selected.name && prompt.version === selected.version && (!prompt.hash || prompt.hash === selected.hash)) ? selected : null);
      setPreview((current) => current && promptList.some((prompt) => prompt.name === current.name && prompt.version === current.version && (!prompt.hash || prompt.hash === current.hash)) ? current : null);
      setError("");
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(actionFailure("Component refresh", failure));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, projectId, connectionEpoch, refreshTick, includeUser, appliedQuery, onStatusChange]);

  async function guarded(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (!client || busy) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setError("");
    try {
      await action(controller.signal);
      if (controller.signal.aborted) return;
      setRefreshTick((value) => value + 1);
      onChanged();
    } catch (failure) {
      if (!controller.signal.aborted) setError(actionFailure(label, failure));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function saveMemory(event: FormEvent) {
    event.preventDefault();
    const request = { scope, content: content.trim(), provenance: provenance.trim() };
    memoryDelivery.current = retryIdentity(memoryDelivery.current, JSON.stringify(request));
    const key = memoryDelivery.current.key;
    void guarded("Memory creation", async (signal) => {
      await client!.createMemory(projectId, { ...request, idempotency_key: key }, signal);
      if (signal.aborted) return;
      if (scope === "user") setIncludeUser(true);
      setContent(""); setProvenance(""); memoryDelivery.current = null;
    });
  }

  function savePrompt(event: FormEvent) {
    event.preventDefault();
    const existing = prompts.find((prompt) => prompt.name === promptName.trim());
    const content = JSON.stringify({ name: promptName.trim(), body: promptBody });
    promptDelivery.current = promptRetryIdentity(promptDelivery.current, content, existing?.version ?? 0);
    const request = { name: promptName.trim(), body: promptBody, expected_version: promptDelivery.current.expectedVersion };
    const key = promptDelivery.current.key;
    void guarded("Prompt creation", async (signal) => {
      let rendered: RenderedPrompt;
      try { rendered = await client!.createPrompt(projectId, { ...request, idempotency_key: key }, signal); }
      catch (failure) {
        if (failure instanceof ApiError && failure.status === 409 && promptDelivery.current?.key === key) promptDelivery.current = { ...promptDelivery.current, refused: true };
        throw failure;
      }
      if (signal.aborted) return;
      setPreview(rendered); setSelectedPrompt(null); setPromptBody(""); promptDelivery.current = null;
    });
  }

  function toggleUserMemory(enabled: boolean) {
    setIncludeUser(enabled);
    if (!enabled) {
      const remaining = selectedMemory.filter((id) => !userMemoryIds.current.has(id));
      setSelectedMemory(remaining);
      onContextChange({ memory_ids: remaining, prompt: selectedPrompt ? { name: selectedPrompt.name, version: selectedPrompt.version, hash: selectedPrompt.hash } : null });
      setRecords((current) => current.filter((record) => record.scope !== "user"));
    }
  }

  return <section className="project-components subpanel" aria-labelledby="components-heading">
    <div className="panel-heading"><h3 id="components-heading">Tickets, memory and prompts</h3><button type="button" className="text-button" disabled={!client || busy || loading} onClick={() => setRefreshTick((value) => value + 1)}>Refresh components</button></div>
    <p className="scope">luuna-missions owns enabled project tickets. luuna-atlas stores explicitly selected knowledge; luuna-beacon provides versioned prompts. The runtime binds selected resources into the exact plan you approve.</p>
    {error && <div className="error" role="alert">{error}<button type="button" className="text-button" onClick={() => setError("")}>Dismiss</button></div>}
    <p role="status">{loading ? "Refreshing component state…" : status?.enabled ? "Project components enabled" : status?.reason ?? "Project components are not enabled."}</p>
    {!status?.enabled && <button type="button" className="primary" disabled={!client || busy || loading || status === null} onClick={() => void guarded("Component activation", async (signal) => {
      const next = await client!.enableComponents(projectId, signal);
      if (signal.aborted) return;
      setStatus(next); onStatusChange(next);
    })}>Enable project components</button>}
    {status?.enabled && <>
      {status.workspace_path && <details className="component-location"><summary>Component data location</summary><code>{status.workspace_path}</code><small>Managed local stores support external CLI edits; refresh and reconcile before re-planning a changed ticket.</small></details>}
      <div className="component-columns">
        <section aria-labelledby="memory-heading"><h4 id="memory-heading">Atlas memory</h4>
          <label className="checkbox"><input type="checkbox" checked={includeUser} disabled={busy} onChange={(event) => toggleUserMemory(event.target.checked)} /> Include private user memory</label>
          <form onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }} className="component-search">
            <label>Search memory<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <button type="submit" disabled={busy || loading}>Search memory</button>
            {appliedQuery && <button type="button" disabled={busy} onClick={() => { setQuery(""); setAppliedQuery(""); }}>Clear search</button>}
          </form>
          <form onSubmit={saveMemory}><fieldset disabled={busy || !client}>
            <label>Memory scope<select aria-label="Memory scope" value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)}><option value="project">Project</option><option value="process">Process</option><option value="user">Private user</option></select></label>
            <label>Memory content<textarea value={content} onChange={(event) => setContent(event.target.value)} required rows={3} maxLength={16000} /></label>
            <label>Memory provenance<input value={provenance} onChange={(event) => setProvenance(event.target.value)} required maxLength={1000} placeholder="Where this knowledge came from" /></label>
            <button type="submit" disabled={!content.trim() || !provenance.trim()}>Save memory</button>
          </fieldset></form>
          <MemorySelection records={records} selected={selectedMemory} busy={busy || loading} onToggle={(record) => setSelectedMemory((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id])} onDelete={(record) => void guarded("Memory deletion", async (signal) => {
            await client!.deleteMemory(projectId, record.id, record.hash, signal);
            setSelectedMemory((ids) => ids.filter((id) => id !== record.id));
          })} />
          {!records.length && <p className="empty">No memory records in this view.</p>}
        </section>
        <section aria-labelledby="prompts-heading"><h4 id="prompts-heading">Beacon prompts</h4>
          <form onSubmit={savePrompt}><fieldset disabled={busy || !client}>
            <label>Prompt name<input value={promptName} onChange={(event) => setPromptName(event.target.value)} required maxLength={100} /></label>
            <label>Prompt body<textarea value={promptBody} onChange={(event) => setPromptBody(event.target.value)} required rows={5} maxLength={16000} /></label>
            <small>Saving an existing name creates its next version after the runtime checks the expected version.</small>
            <button type="submit" disabled={!promptName.trim() || !promptBody.trim()}>Save prompt</button>
          </fieldset></form>
          <ul className="component-records" aria-label="Beacon prompts">{prompts.map((prompt) => <li key={prompt.name}><strong>{prompt.name} · version {prompt.version}</strong><button type="button" disabled={busy} onClick={() => void guarded("Prompt preview", async (signal) => {
            const rendered = await client!.renderPrompt(projectId, prompt.name, prompt.version, signal);
            if (!signal.aborted) { promptDelivery.current = promptDeliveryAfterPreview(promptDelivery.current, rendered.version); setPreview(rendered); setPromptName(prompt.name); setPromptBody(promptEditBody(rendered.body)); }
          })}>Preview prompt</button></li>)}</ul>
          {preview && <PromptPreview prompt={preview} selected={selectedPrompt?.hash === preview.hash} busy={busy} onSelect={() => setSelectedPrompt((selected) => selected?.hash === preview.hash ? null : preview)} />}
        </section>
      </div>
      <p className="component-context" role="status">Next plan: {selectedMemory.length} selected memory record(s){selectedPrompt ? ` · ${selectedPrompt.name} v${selectedPrompt.version}` : " · no prompt selected"}. Selected content and provenance appear in the plan for review and are sent to the writer and reviewer only after approval. Private user memory requires explicit selection.</p>
    </>}
  </section>;
}
