import { useState } from "react";
import { Button, Form, FormFooter, RecordItem, RecordList, TextField, submitted } from "../ui";
import type { RepositoryRow } from "./project-model";

const FIRST_ROW: RepositoryRow = { id: "app", path: "" };

/**
 * Registers a project with every related repository at once (R05). The form clears itself once
 * the runtime has registered the project.
 */
export function RegisterForm({ disabled, onRegister }: { disabled: boolean; onRegister: (name: string, projectId: string, rows: RepositoryRow[]) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<RepositoryRow[]>([FIRST_ROW]);
  const rowsComplete = rows.length > 0 && rows.every((row) => row.id.trim() && row.path.trim());
  const update = (index: number, patch: Partial<RepositoryRow>) => setRows((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  async function register() {
    if (!(await onRegister(name, projectId, rows))) return;
    setName("");
    setProjectId("");
    setRows([FIRST_ROW]);
  }

  return <Form onSubmit={submitted(() => void register())} className="register-form form-group" disabled={disabled}>
    <TextField label="Project name" value={name} onChange={(event) => setName(event.target.value)} required placeholder="My product" />
    <TextField label="Project ID" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="derived from the name" mono pattern="[a-z][a-z0-9\-]{0,63}" />
    <RecordList className="repository-rows" label="Repositories to register">{rows.map((row, index) => <RecordItem key={index} className="repository-row field-row">
      <TextField label="Repository ID" value={row.id} onChange={(event) => update(index, { id: event.target.value })} required mono pattern="[a-z][a-z0-9\-]{0,63}" />
      <TextField label="Repository root path" value={row.path} onChange={(event) => update(index, { path: event.target.value })} required mono placeholder="/absolute/path/to/checkout" />
      {rows.length > 1 && <Button variant="text" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove repository {row.id || index + 1}</Button>}
    </RecordItem>)}</RecordList>
    <Button variant="text" onClick={() => setRows((current) => [...current, { id: "", path: "" }])}>Add another repository</Button>
    <FormFooter hint="Register every related repository together. Paths stay on this machine and never enter the manifest.">
      <Button variant="primary" submit disabled={!name.trim() || !rowsComplete} data-capability="projects.register">
        Register {rows.length > 1 ? `${rows.length} repositories` : "repository"}
      </Button>
    </FormFooter>
  </Form>;
}
