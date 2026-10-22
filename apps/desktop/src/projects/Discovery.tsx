import type { Discovery as DiscoveryProposal, ProjectView } from "@luuna/api-client";
import { Button, CalloutList, Form, FormFooter, Id, Item, ListGroup, ListRow, Meta, ReasonNote, StatusBadge, TextArea, submitted, confidenceTone } from "@luuna/ui";

/**
 * The discovery's proposal for the next manifest revision: open questions, problems the draft
 * must fix, the proposed check recipes, and the editable draft the developer confirms.
 */
export function DiscoveryReview({ discovery, view, draft, busy, onDraft, onConfirm }: {
  discovery: DiscoveryProposal; view: ProjectView; draft: string; busy: boolean;
  onDraft: (draft: string) => void; onConfirm: () => void;
}) {
  const recipes = discovery.repositories.flatMap((repo) => repo.proposed_checks.map((proposed) => ({ repo, proposed })));
  return <>
    {discovery.questions.length > 0 && <CalloutList className="project-questions questions" tone="attention" label="Open questions">
      {discovery.questions.map((question, index) => <Item key={index}><strong>{question.topic}</strong> {question.detail}</Item>)}
    </CalloutList>}
    {discovery.manifest_problems.length > 0 && <ReasonNote block className="manifest-problems" tone="attention" reason={`Proposal needs edits before confirmation: ${discovery.manifest_problems.join("; ")}`} />}
    <ListGroup className="recipes" aria-label="Proposed check recipes">{recipes.map(({ repo, proposed }) => <ListRow key={`${repo.repository_id}-${proposed.check.id}`} className="recipe-record"
      title={<Id className="recipe-command">{proposed.check.executable} {proposed.check.args.join(" ")}</Id>}
      trailing={<StatusBadge tone={confidenceTone[proposed.confidence]}>{proposed.check.required ? "required" : "optional"} · {proposed.confidence}</StatusBadge>}
      detail={<Meta className="recipe-evidence">{proposed.evidence.join(" · ")}</Meta>} />)}</ListGroup>
    <Form onSubmit={submitted(onConfirm)} className="manifest-form" disabled={busy}>
      <TextArea label={`Manifest to confirm (revision ${view.project.revision + 1})`} value={draft} onChange={(event) => onDraft(event.target.value)} rows={14} mono />
      <FormFooter hint="Confirmation re-checks identity, remote and default branch against the live checkout and records the exact base commit.">
        <Button variant="primary" submit data-capability="projects.manifest.confirm">Confirm manifest</Button>
      </FormFooter>
    </Form>
  </>;
}
