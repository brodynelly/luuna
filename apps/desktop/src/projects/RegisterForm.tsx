import { useState } from "react";
import { Button, Form, FormFooter, Stack, TextField, submitted } from "@luuna/ui";
import type { RepositoryRow } from "./project-model";

const FIRST_ROW: RepositoryRow = { id: "app", path: "" };

/**
 * A repository id from the checkout's folder name (ADR 0040): `C:\\src\\My API` becomes `my-api`.
 * The developer can still type their own; an id is only derived while they have not.
 */
export function repositoryIdFromPath(path: string): string {
  const folder = path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const slug = folder.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return "";
  return (/^[a-z]/.test(slug) ? slug : `repo-${slug}`).slice(0, 64).replace(/-+$/, "");
}

/**
 * Registers a project with every related repository at once (R05). The form clears itself once
 * the runtime has registered the project.
 */
export function RegisterForm({ disabled, onRegister }: { disabled: boolean; onRegister: (name: string, projectId: string, rows: RepositoryRow[]) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<RepositoryRow[]>([FIRST_ROW]);
  // Rows whose id the developer typed; the others follow their path's folder name.
  const [typed, setTyped] = useState<boolean[]>([false]);
  const rowsComplete = rows.length > 0 && rows.every((row) => row.id.trim() && row.path.trim());
  const update = (index: number, patch: Partial<RepositoryRow>) => setRows((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const setPath = (index: number, path: string) => {
    const derived = repositoryIdFromPath(path);
    update(index, typed[index] || !derived ? { path } : { path, id: derived });
  };
  const setId = (index: number, id: string) => {
    setTyped((current) => current.map((value, i) => i === index ? id !== "" : value));
    update(index, { id });
  };

  async function register() {
    if (!(await onRegister(name, projectId, rows))) return;
    setName("");
    setProjectId("");
    setRows([FIRST_ROW]);
    setTyped([false]);
  }

  return <Form onSubmit={submitted(() => void register())} className="form-group" disabled={disabled}>
    <Stack gap={3}>
      <TextField label="Project name" value={name} onChange={(event) => setName(event.target.value)} required placeholder="My product" />
      <TextField label="Project ID" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="derived from the name" mono pattern="[a-z][a-z0-9\-]{0,63}" />
    </Stack>
    <Stack gap={3} role="group" aria-label="Repositories to register">{rows.map((row, index) => <Stack key={index} className="repository-row" gap={2}>
      <TextField label="Repository root path" value={row.path} onChange={(event) => setPath(index, event.target.value)} required mono placeholder="/absolute/path/to/checkout" />
      <TextField label="Repository ID (from the folder name; edit to choose another)" value={row.id} onChange={(event) => setId(index, event.target.value)} required mono pattern="[a-z][a-z0-9\-]{0,63}" />
      {rows.length > 1 && <Button variant="text" onClick={() => { setRows((current) => current.filter((_, i) => i !== index)); setTyped((current) => current.filter((_, i) => i !== index)); }}>Remove repository {row.id || index + 1}</Button>}
    </Stack>)}</Stack>
    <Button variant="text" onClick={() => { setRows((current) => [...current, { id: "", path: "" }]); setTyped((current) => [...current, false]); }}>Add another repository</Button>
    <FormFooter hint="Register every related repository together. Paths stay on this machine and never enter the manifest.">
      <Button variant="primary" submit disabled={!name.trim() || !rowsComplete} data-capability="projects.register">
        Register {rows.length > 1 ? `${rows.length} repositories` : "repository"}
      </Button>
    </FormFooter>
  </Form>;
}
