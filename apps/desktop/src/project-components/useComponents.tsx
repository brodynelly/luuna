import { useEffect, useRef, useState } from "react";
import type { ComponentContext, ComponentStatus, LuunaClient, MemoryRecord, MemoryRetentionPolicy, MemoryRetentionResult, MemoryScope, PromptRecord, RenderedPrompt, UserMemoryExport } from "@luuna/api-client";
import { ApiError } from "@luuna/api-client";
import { actionFailure } from "../failures";
import { promptDeliveryAfterPreview, promptEditBody, promptRetryIdentity, retryIdentity } from "./model";
import type { PromptDelivery } from "./model";

export interface ComponentsProps {
  client: LuunaClient | null;
  projectId: string;
  connectionEpoch?: number;
  onContextChange: (context: ComponentContext) => void;
  onStatusChange: (status: ComponentStatus) => void;
  onChanged: () => void;
}

const sameResource = (a: { name: string; version: number; hash?: string | null }, b: RenderedPrompt) => a.name === b.name && a.version === b.version && (!a.hash || a.hash === b.hash);

/** The project's component state: status, memory, prompts and what the next plan selects. The runtime owns storage, authority and identity. */
export function useComponents({ client, projectId, connectionEpoch = 0, onContextChange, onStatusChange, onChanged }: ComponentsProps) {
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
  const [retention, setRetention] = useState<MemoryRetentionPolicy | null>(null);
  const [processDays, setProcessDays] = useState("");
  const [projectDays, setProjectDays] = useState("");
  const [retentionApplied, setRetentionApplied] = useState<MemoryRetentionResult | null>(null);
  const [retentionAcknowledged, setRetentionAcknowledged] = useState(false);
  const [userExport, setUserExport] = useState<UserMemoryExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const memoryDelivery = useRef<{ content: string; key: string } | null>(null);
  const promptDelivery = useRef<PromptDelivery | null>(null);
  const userMemoryIds = useRef(new Set<string>());
  const context = (memory: string[]) => ({ memory_ids: memory, prompt: selectedPrompt ? { name: selectedPrompt.name, version: selectedPrompt.version, hash: selectedPrompt.hash } : null });

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    onContextChange(context(selectedMemory));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const [memory, promptList, policy] = await Promise.all([
        client.listMemory(projectId, { query: appliedQuery, includeUser }, controller.signal),
        client.listPrompts(projectId, controller.signal),
        client.memoryRetention(projectId, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setRecords(memory);
      setRetention(policy);
      setProcessDays(policy.process_max_age_days === null ? "" : String(policy.process_max_age_days));
      setProjectDays(policy.project_max_age_days === null ? "" : String(policy.project_max_age_days));
      for (const record of memory) if (record.scope === "user") userMemoryIds.current.add(record.id);
      setPrompts(promptList);
      if (!appliedQuery) setSelectedMemory((ids) => ids.filter((id) => memory.some((record) => record.id === id)));
      setSelectedPrompt((selected) => selected && promptList.some((prompt) => sameResource(prompt, selected)) ? selected : null);
      setPreview((current) => current && promptList.some((prompt) => sameResource(prompt, current)) ? current : null);
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

  function saveMemory() {
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

  function savePrompt() {
    const existing = prompts.find((prompt) => prompt.name === promptName.trim());
    const body = JSON.stringify({ name: promptName.trim(), body: promptBody });
    promptDelivery.current = promptRetryIdentity(promptDelivery.current, body, existing?.version ?? 0);
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

  function previewPrompt(prompt: PromptRecord) {
    void guarded("Prompt preview", async (signal) => {
      const rendered = await client!.renderPrompt(projectId, prompt.name, prompt.version, signal);
      if (signal.aborted) return;
      promptDelivery.current = promptDeliveryAfterPreview(promptDelivery.current, rendered.version);
      setPreview(rendered); setPromptName(prompt.name); setPromptBody(promptEditBody(rendered.body));
    });
  }

  function toggleUserMemory(enabled: boolean) {
    setIncludeUser(enabled);
    if (!enabled) {
      const remaining = selectedMemory.filter((id) => !userMemoryIds.current.has(id));
      setSelectedMemory(remaining);
      onContextChange(context(remaining));
      setRecords((current) => current.filter((record) => record.scope !== "user"));
    }
  }

  return {
    client, projectId, status, setStatus, onStatusChange, records, prompts, selectedMemory, setSelectedMemory, selectedPrompt, setSelectedPrompt,
    preview, scope, setScope, content, setContent, provenance, setProvenance, includeUser, query, setQuery, appliedQuery, setAppliedQuery,
    promptName, setPromptName, promptBody, setPromptBody, setRefreshTick, retention, setRetention, processDays, setProcessDays, projectDays, setProjectDays,
    retentionApplied, setRetentionApplied, retentionAcknowledged, setRetentionAcknowledged, userExport, setUserExport, busy, loading, error, setError,
    guarded, saveMemory, savePrompt, previewPrompt, toggleUserMemory,
  };
}

export type ComponentsState = ReturnType<typeof useComponents>;
