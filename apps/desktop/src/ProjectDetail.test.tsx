import { expect, test } from "vitest";
import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { ProjectDetail } from "./projects/ProjectDetail";
import type { ProjectsState } from "./projects/useProjects";

/**
 * React reports "Encountered two children with the same key" when two siblings share a key, and a
 * project id (for example `windows`) used as the key of both the rebind form and the components
 * panel did exactly that. ProjectDetail has no hooks, so its element tree is read directly.
 */
function siblingKeys(projectId: string): string[] {
  const view = { project: { id: projectId, name: "Project", revision: 1 }, repositories: [{ repository_id: "app", local_path: "/work/app", observation: { branch: "main", head: "c".repeat(40), tree: "t".repeat(40), clean: true } }], manifest: null, prerequisites: [] };
  const state = { view, busy: false, baselines: [], discovery: null, exported: null, selected: projectId, events: [], pendingBaselineRuns: {}, baselineLog: null, requested: null, componentContext: null, componentStatus: null } as unknown as ProjectsState;
  const card = ProjectDetail({ client: null, connectionEpoch: 0, state, actions: {} as never }) as ReactElement<{ children: unknown }>;
  return Children.toArray(card.props.children as ReactNode).filter(isValidElement).map((child) => String(child.key));
}

test("sibling elements of the project detail never share a key, whatever the project id", () => {
  for (const id of ["windows", "walkthrough", "linux"]) {
    const keys = siblingKeys(id).filter((key) => key.includes(id));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(keys.length);
  }
});
