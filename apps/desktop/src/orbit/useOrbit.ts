import { useEffect, useRef, useState } from "react";
import type { LuunaClient, OrbitExecution, OrbitView, ProjectRecord, SandboxNetwork, SandboxPlan } from "@luuna/api-client";
import { actionFailure, describeFailure } from "../failures";
import { orbitActions } from "./orbit-model";

/**
 * The Orbit view's state: the project list, the selected project's status, the repository
 * selection, the latest execution and the sandbox plan. It reloads after an outage (a new
 * connection epoch) like every other view and runs one action at a time.
 */
export function useOrbit(client: LuunaClient | null, connectionEpoch: number, refreshEpoch: number) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<OrbitView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [parallel, setParallel] = useState(false);
  const [execution, setExecution] = useState<OrbitExecution | null>(null);
  const [network, setNetwork] = useState<SandboxNetwork>("open");
  const [plan, setPlan] = useState<SandboxPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const shownProject = useRef<string | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  // Another runtime: nothing read from the previous one is shown or reused.
  useEffect(() => {
    operation.current?.abort();
    setBusy(false);
    setProjects([]);
    setProjectId(null);
    shownProject.current = null;
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    client.listProjects(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      setProjects(list);
      setProjectId((id) => (id && list.some((project) => project.id === id) ? id : list[0]?.id ?? null));
    }).catch((failure) => { if (!controller.signal.aborted) setError(describeFailure(failure)); });
    return () => controller.abort();
  }, [client, connectionEpoch]);

  useEffect(() => {
    if (shownProject.current !== projectId) { setView(null); setExecution(null); setPlan(null); }
    if (!client || !projectId) return;
    const controller = new AbortController();
    setLoading(true);
    orbitActions.status(client, projectId, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      const ids = next.repositories.map((repository) => repository.repository_id);
      // A new project selects every repository; a refresh keeps the developer's choice. Read the
      // ref now: the updater runs at the next render, after the ref below has moved on.
      const refresh = shownProject.current === next.project_id;
      setSelected((current) => (refresh ? ids.filter((id) => current.includes(id)) : ids));
      shownProject.current = next.project_id;
      setView(next);
    }).catch((failure) => { if (!controller.signal.aborted) setError(describeFailure(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, projectId, connectionEpoch, refreshEpoch, tick]);

  useEffect(() => {
    setPlan(null);
    if (!client || !projectId) return;
    const controller = new AbortController();
    orbitActions.sandbox(client, projectId, network, controller.signal).then((next) => { if (!controller.signal.aborted) setPlan(next); })
      .catch((failure) => { if (!controller.signal.aborted) setError(actionFailure("Sandbox plan", failure)); });
    return () => controller.abort();
  }, [client, projectId, network, connectionEpoch, refreshEpoch, tick]);

  /** Runs one action at a time; a refusal is explained with the shared failure helpers. */
  async function act(label: string, action: (signal: AbortSignal) => Promise<OrbitExecution>) {
    if (!client || !projectId) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await action(controller.signal);
      if (controller.signal.aborted) return;
      setExecution(result);
      setTick((value) => value + 1);
    } catch (failure) {
      if (!controller.signal.aborted) setError(actionFailure(label, failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const all = view?.repositories.map((repository) => repository.repository_id) ?? [];
  const actions = {
    exec: (line: string, timeout: string) => void act("Run in every repository", (signal) => orbitActions.exec(client!, projectId!, { line, timeout, selected, all, parallel }, signal)),
    run: (recipe: string) => void act("Recipe run", (signal) => orbitActions.run(client!, projectId!, recipe, selected, all, parallel, signal)),
    sync: (fetch: boolean) => void act("Sync", (signal) => orbitActions.sync(client!, projectId!, fetch, selected, all, signal)),
  };

  return {
    projects, projectId, setProjectId, view, selected, setSelected, parallel, setParallel, execution, network, setNetwork, plan,
    error, setError, busy, loading, refresh: () => setTick((value) => value + 1), actions,
  };
}
