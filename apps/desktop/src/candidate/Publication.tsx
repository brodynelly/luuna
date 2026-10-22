import type { PublicationRecord } from "@luuna/api-client";
import type { Tone } from "../design/tone";
import { Box, ExternalLink, Hint, Id, Item, ReasonNote, RecordList, StatusBadge, Text } from "../ui";

function publicationTone(publication: PublicationRecord): Tone {
  if (publication.publication_state === "integrated") return "success";
  if (publication.publication_state === "failed") return "danger";
  return publication.active ? "active" : "neutral";
}

type Repository = PublicationRecord["repositories"][string];

/** One published repository: its branch, pull request, observed CI and merge state. */
function PublishedRepository({ id, repository }: { id: string; repository: Repository }) {
  const merged = repository.merge.merged ? `merged${repository.merge.merged_by ? ` by ${repository.merge.merged_by}` : ""}` : "not merged; merging stays with you on GitHub";
  return <Item>
    <strong>{id}</strong> · branch <Id>{repository.branch}</Id> at <Id>{repository.commit.slice(0, 12)}</Id> · push {repository.push} · pull request {repository.pull_request
      ? <ExternalLink href={repository.pull_request.url}>#{repository.pull_request.number}</ExternalLink>
      : repository.pull_request_step}
    <Hint> · CI {repository.ci.state}{repository.ci.reason ? ` (${repository.ci.reason})` : ""} · {merged}</Hint>
    {repository.reason && <ReasonNote tone="danger" reason={` · ${repository.reason}`} />}
  </Item>;
}

/** The durable publication record: branches, pull requests, observed CI and merge state. Luuna never merges. */
export function PublicationSummary({ publication }: { publication: PublicationRecord }) {
  const tone = publicationTone(publication);
  return <Box className="publication subpanel" aria-label="Publication record" data-tone={tone}>
    <Text><strong>Publication</strong> <StatusBadge tone={tone}>{publication.publication_state}</StatusBadge>{publication.active && <Hint> in progress</Hint>}</Text>
    {publication.reason && <ReasonNote block tone="danger" reason={publication.reason} />}
    {publication.superseded_by_repair && <Text className="recovery-note" role="status">
      Superseded: this publication's candidate was sent to a bounded repair after its pull request failed CI. The pull request stays yours to close; the repaired candidate publishes under a new branch whose pull request names this one.{publication.superseded_reason ? ` ${publication.superseded_reason}` : ""}
    </Text>}
    <RecordList label="Published repositories">{Object.entries(publication.repositories).map(([id, repository]) => <PublishedRepository key={id} id={id} repository={repository} />)}</RecordList>
  </Box>;
}
