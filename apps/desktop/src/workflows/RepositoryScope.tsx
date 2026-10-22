import { Checkbox, InlineFields } from "@luuna/ui";

/** The repositories a ticket may touch, one checkbox each, in the order they were ticked. */
export function RepositoryScope({ choices, selected, onChange }: { choices: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  return <InlineFields columns={3} className="ticket-repositories" label="Repositories the ticket may touch">
    {choices.map((id) => <Checkbox key={id} className="checkbox" label={id} checked={selected.includes(id)}
      onChange={(event) => onChange(event.target.checked ? [...selected.filter((item) => item !== id), id] : selected.filter((item) => item !== id))} />)}
  </InlineFields>;
}
