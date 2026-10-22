import { useMemo, useState } from "react";
import type { ProjectExport, ProjectImportResult } from "@luuna/api-client";
import { Button, Form, FormFooter, Id, StatusLine, TextArea, TextField, submitted } from "@luuna/ui";
import { parseProjectExport } from "./project-model";

export interface ImportRequest { draft: ProjectExport; repositories: { id: string; path: string }[] }

/**
 * Imports a project export from another machine: the pasted export names its repositories, and
 * the developer gives each one's local clone. The runtime checks the hash and the identities.
 */
export function ImportForm({ disabled, onImport }: { disabled: boolean; onImport: (request: ImportRequest) => Promise<ProjectImportResult | null> }) {
  const [text, setText] = useState("");
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ProjectImportResult | null>(null);
  const draft = useMemo(() => parseProjectExport(text), [text]);
  const repositories = draft?.manifest?.repositories.map((repository) => repository.id) ?? [];
  const ready = draft !== null && repositories.length > 0 && repositories.every((id) => (paths[id] ?? "").trim());

  async function importProject() {
    if (!draft || !ready) return;
    setResult(null);
    const imported = await onImport({ draft, repositories: repositories.map((id) => ({ id, path: (paths[id] ?? "").trim() })) });
    if (!imported) return;
    setResult(imported);
    setText("");
    setPaths({});
  }

  return <>
    <Form onSubmit={submitted(() => void importProject())} className="form-group" disabled={disabled}>
      <TextArea label="Export JSON" value={text} onChange={(event) => setText(event.target.value)} rows={4} mono placeholder='{"kind":"luuna-project-export", …}' aria-describedby="import-note" />
      {text.trim() && !draft && <StatusLine>The pasted text is not a Luuna project export.</StatusLine>}
      {repositories.map((id) => <TextField key={id} label={<>Checkout of repository <Id>{id}</Id></>} value={paths[id] ?? ""} onChange={(event) => setPaths({ ...paths, [id]: event.target.value })} required mono placeholder="/absolute/path/to/clone" />)}
      <FormFooter hintId="import-note" hint="The runtime checks the export hash, matches each clone's remote and root commits against the exported identity, and refuses user memory, credentials and host paths. Tickets, project and process memory and prompts arrive through Missions, Atlas and Beacon.">
        <Button variant="primary" submit disabled={!ready} data-capability="projects.import">Import project</Button>
      </FormFooter>
    </Form>
    {result && <StatusLine>
      Imported <Id>{result.project.project.id}</Id> at manifest <Id>{result.manifest_hash.slice(0, 23)}…</Id>: {result.counts.tickets} tickets, {result.counts.memory} memories, {result.counts.prompts} prompts
      {result.components_enabled ? "" : " (components not enabled on this host)"}{result.replayed ? " (replayed)" : ""}.
    </StatusLine>}
  </>;
}
