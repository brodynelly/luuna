import { useState } from "react";
import type { ProjectView } from "@luuna/api-client";
import { Button, Checkbox, Disclosure, Form, FormFooter, SelectField, TextField, options, submitted } from "../ui";

/**
 * Binds a registered repository to a moved checkout or a changed remote, on purpose. Rendered
 * per selected project (keyed by it), so its fields start empty for each project.
 */
export function RebindForm({ view, busy, onRebind }: { view: ProjectView; busy: boolean; onRebind: (repositoryId: string, path: string) => Promise<boolean> }) {
  const [repository, setRepository] = useState("");
  const [path, setPath] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const registration = view.repositories[0];
  const target = view.repositories.find((item) => item.repository_id === repository) ?? registration;

  async function rebind() {
    if (!registration || !confirmed) return;
    if (!(await onRebind(repository || registration.repository_id, path.trim()))) return;
    setPath("");
    setConfirmed(false);
  }

  return <Disclosure className="rebind" summary="Rebind repository">
    <Form onSubmit={submitted(() => void rebind())} className="rebind-form" disabled={busy}>
      {view.repositories.length > 1 && <SelectField label="Repository to rebind" aria-label="Repository to rebind" value={target?.repository_id ?? ""} onChange={(event) => setRepository(event.target.value)} options={options(view.repositories.map((item) => item.repository_id))} />}
      <TextField label="New repository root path (empty re-inspects the registered path)" value={path} onChange={(event) => setPath(event.target.value)} mono placeholder={target?.local_path ?? registration?.local_path} />
      <Checkbox className="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} label={`I moved this checkout or changed its remote on purpose; bind ${target?.repository_id ?? registration?.repository_id} to it.`} />
      <FormFooter hint="The runtime inspects the checkout read-only and records the old and new identity. Plans, baselines and approvals stay bound to exact commits; a manifest whose remote no longer matches must be confirmed again.">
        <Button variant="primary" submit disabled={!confirmed} data-capability="projects.repositories.rebind">Rebind repository</Button>
      </FormFooter>
    </Form>
  </Disclosure>;
}
