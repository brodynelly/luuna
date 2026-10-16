import type { Issue } from "./types.ts";

export type SortMode = "priority" | "created" | "updated" | "id";

export const VALID_SORT_MODES: readonly SortMode[] = ["priority", "created", "updated", "id"];

export function isSortMode(value: string): value is SortMode {
	return (VALID_SORT_MODES as readonly string[]).includes(value);
}

export function sortIssues(issues: Issue[], mode: SortMode = "priority"): Issue[] {
	const sorted = [...issues];
	switch (mode) {
		case "priority":
			sorted.sort((a, b) => {
				if (a.priority !== b.priority) return a.priority - b.priority;
				return b.createdAt.localeCompare(a.createdAt);
			});
			break;
		case "created":
			sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			break;
		case "updated":
			sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
			break;
		case "id":
			sorted.sort((a, b) => a.id.localeCompare(b.id));
			break;
	}
	return sorted;
}
