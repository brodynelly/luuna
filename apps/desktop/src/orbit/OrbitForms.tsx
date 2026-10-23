import { useEffect, useState } from "react";
import type { OrbitView } from "@luuna/api-client";
import { ORBIT_TIMEOUT_LIMITS } from "@luuna/api-client";
import { Box, Button, Checkbox, FieldRow, Form, FormFooter, Group, Hint, Section, SelectField, TextField, options, submitted } from "@luuna/ui";

export interface OrbitFormActions {
  exec: (line: string, timeout: string) => void;
  run: (recipe: string) => void;
  sync: (fetch: boolean) => void;
}

/** Which repositories the next action reaches (default all) and whether they run in parallel. */
export function RepositoryChoice({ view, selected, parallel, disabled, onSelected, onParallel }: {
  view: OrbitView; selected: readonly string[]; parallel: boolean; disabled: boolean;
  onSelected: (ids: string[]) => void; onParallel: (parallel: boolean) => void;
}) {
  const all = view.repositories.map((repository) => repository.repository_id);
  const toggle = (id: string, on: boolean) => onSelected(all.filter((item) => (item === id ? on : selected.includes(item))));
  return <Group className="orbit-choice" label="Repositories to act on">
    <Box className="orbit-checks">{view.repositories.map((repository) => <Checkbox key={repository.repository_id} label={<>{repository.repository_id}{repository.present ? "" : " (missing checkout)"}</>}
      checked={selected.includes(repository.repository_id)} disabled={disabled} onChange={(event) => toggle(repository.repository_id, event.target.checked)} />)}</Box>
    <Box className="orbit-checks">
      <Button variant="text" disabled={disabled || selected.length === all.length} onClick={() => onSelected(all)}>Select all</Button>
      <Checkbox label="Run in parallel (up to four at once)" checked={parallel} disabled={disabled} onChange={(event) => onParallel(event.target.checked)} />
    </Box>
  </Group>;
}

/** Run in every repository, run a recipe, and sync: the developer's own commands, never agent actions. */
export function OrbitForms({ view, disabled, actions }: { view: OrbitView; disabled: boolean; actions: OrbitFormActions }) {
  const [line, setLine] = useState("");
  const [timeout, setTimeoutText] = useState("");
  const [recipe, setRecipe] = useState(view.recipes[0] ?? "");
  const [fetch, setFetch] = useState(true);
  useEffect(() => setRecipe((current) => (view.recipes.includes(current) ? current : view.recipes[0] ?? "")), [view.recipes]);
  const [low, high] = ORBIT_TIMEOUT_LIMITS;
  return <Box className="orbit-forms">
    <Section id="orbit-exec-heading" level={4} variant="subpanel" title="Run in every repository" description="One executable and its arguments, run in each selected checkout without a shell; quotes group words. It runs with your permissions, like typing it in each checkout.">
      <Form className="orbit-exec" disabled={disabled} onSubmit={submitted(() => actions.exec(line, timeout))}>
        <FieldRow>
          <TextField label="Command" mono value={line} placeholder="git status --short" autoComplete="off" onChange={(event) => setLine(event.target.value)} />
          <TextField label="Timeout in seconds (optional)" type="number" min={low} max={high} step={1} inputMode="numeric" value={timeout} placeholder="300" onChange={(event) => setTimeoutText(event.target.value)} />
        </FieldRow>
        <FormFooter hint={`The runtime stops each command after the timeout (${low} to ${high} seconds, default 300).`}>
          <Button submit variant="primary" disabled={!line.trim()} data-capability="orbit.exec">Run command</Button>
        </FormFooter>
      </Form>
    </Section>
    <Section id="orbit-run-heading" level={4} variant="subpanel" title="Run a recipe" description="A confirmed manifest recipe, in each selected repository that defines it; the others are reported skipped.">
      <Form className="orbit-run" disabled={disabled || view.recipes.length === 0} onSubmit={submitted(() => actions.run(recipe))}>
        {view.recipes.length > 0
          ? <SelectField label="Recipe" value={recipe} onChange={(event) => setRecipe(event.target.value)} options={options(view.recipes)} />
          : <Hint>The confirmed manifest defines no recipe for these repositories.</Hint>}
        <FormFooter>
          <Button submit variant="primary" disabled={!recipe} data-capability="orbit.run">Run recipe</Button>
        </FormFooter>
      </Form>
    </Section>
    <Section id="orbit-sync-heading" level={4} variant="subpanel" title="Sync" description="A missing checkout is cloned from its registered remote and its identity re-verified; a present one is fetched. Nothing is merged or checked out.">
      <Form className="orbit-sync" disabled={disabled} onSubmit={submitted(() => actions.sync(fetch))}>
        <Checkbox label="Fetch present checkouts" checked={fetch} onChange={(event) => setFetch(event.target.checked)} />
        <FormFooter>
          <Button submit data-capability="orbit.sync">Sync</Button>
        </FormFooter>
      </Form>
    </Section>
  </Box>;
}
