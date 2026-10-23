import type { OrbitRepository, OrbitView } from "@luuna/api-client";
import { presenceTone } from "@luuna/ui";
import { Box, Id, Meta, ReasonNote, StatusBadge, Table, Tag } from "@luuna/ui";
import type { TableColumn } from "@luuna/ui";
import { dirtyText, tailPath, upstreamText } from "./orbit-model";

const COLUMNS: readonly TableColumn<OrbitRepository>[] = [
  {
    id: "repository", header: "Repository",
    cell: (row) => <Box className="orbit-cell"><Id>{row.repository_id}</Id><Meta><span className="orbit-path" title={row.local_path}><Id>{tailPath(row.local_path)}</Id></span></Meta></Box>,
  },
  {
    id: "checkout", header: "Checkout",
    cell: (row) => <Box className="orbit-cell">
      <StatusBadge tone={presenceTone(row.present)}>{row.present ? "present" : "missing checkout"}</StatusBadge>
      {row.error && <ReasonNote tone="danger" reason={row.error} />}
    </Box>,
  },
  {
    id: "branch", header: "Branch",
    cell: (row) => row.present ? <Box className="orbit-cell"><Id>{row.branch ?? "detached HEAD"}</Id>{row.head_commit && <Meta><Id>{row.head_commit.slice(0, 12)}</Id></Meta>}</Box> : <Meta>—</Meta>,
  },
  {
    id: "upstream", header: "Upstream",
    cell: (row) => row.present ? <Box className="orbit-cell"><span>{upstreamText(row)}</span>{row.upstream && <Meta><Id>{row.upstream.name}</Id></Meta>}</Box> : <Meta>—</Meta>,
  },
  { id: "changes", header: "Changes", cell: (row) => row.present ? <span>{dirtyText(row.dirty)}</span> : <Meta>—</Meta> },
  {
    id: "recipes", header: "Recipes",
    cell: (row) => row.recipes.length ? <Box className="orbit-tags">{row.recipes.map((recipe) => <Tag key={recipe}>{recipe}</Tag>)}</Box> : <Meta>none</Meta>,
  },
];

/** Read-only status of every registered checkout, as the runtime observed it. */
export function OrbitStatusTable({ view }: { view: OrbitView }) {
  return <Box className="orbit-status">
    <Meta block>
      {view.repositories.length} {view.repositories.length === 1 ? "repository" : "repositories"} · manifest {view.manifest_revision ? `r${view.manifest_revision}` : "not confirmed"} · observed <time dateTime={view.observed_at}>{view.observed_at}</time>
    </Meta>
    <Table label={`Repositories of ${view.name}`} className="orbit-table" columns={COLUMNS} rows={view.repositories} rowKey={(row) => row.repository_id} />
  </Box>;
}
