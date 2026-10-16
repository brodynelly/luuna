// seeds-76af: child seeds spawned by `sd plan submit` carry a backref block in
// description so an agent picking one up cold has the framing the plan author
// already wrote down — without having to navigate plan_id → parent → plan.

export const BACKREF_START = "<!-- seeds:plan-backref:start -->";
export const BACKREF_END = "<!-- seeds:plan-backref:end -->";

const APPROACH_EXCERPT_MAX = 240;

export interface BackrefArgs {
	// 0-based step index in plan.sections.steps. Omit for loose adoptions
	// (sd plan adopt without --step) where the seed has no step anchor.
	stepIndex?: number;
	planId: string;
	parentSeedId: string;
	parentSeedTitle: string;
	templateName: string;
	approach: unknown;
}

export function buildPlanBackref(args: BackrefArgs): string {
	const lines: string[] = [];
	if (args.stepIndex !== undefined) {
		lines.push(`Step ${args.stepIndex + 1} of plan ${args.planId}.`);
	} else {
		lines.push(`Adopted into plan ${args.planId}.`);
	}
	lines.push("");
	lines.push(`Parent seed: ${args.parentSeedId} — ${args.parentSeedTitle}`);
	lines.push(`Plan template: ${args.templateName}`);
	const excerpt = approachExcerpt(args.approach);
	if (excerpt) lines.push(`Plan approach: ${excerpt}`);
	lines.push("");
	lines.push(
		`Run \`sd plan show ${args.planId}\` for the full plan (context, alternatives, sibling steps, acceptance criteria).`,
	);
	const body = lines.join("\n");
	return `${BACKREF_START}\n${body}\n${BACKREF_END}`;
}

// Replace the marker section if present; otherwise, prepend a fresh section in
// front of the existing description so manual notes survive plan overwrite.
export function applyPlanBackref(existing: string | undefined, args: BackrefArgs): string {
	const block = buildPlanBackref(args);
	const prior = existing ?? "";
	if (hasBackrefMarkers(prior)) {
		return replaceBackrefSection(prior, block);
	}
	if (prior.trim().length === 0) return block;
	return `${block}\n\n${prior}`;
}

// Inverse of applyPlanBackref: strip the marker-delimited block so a released
// seed loses its plan framing. Manual notes wrapping the block are preserved;
// whitespace at the new boundary is collapsed. Returns undefined when nothing
// but the block remained, so the caller can drop the field entirely.
export function stripPlanBackref(existing: string | undefined): string | undefined {
	if (existing === undefined) return undefined;
	if (!hasBackrefMarkers(existing)) return existing;
	const startIdx = existing.indexOf(BACKREF_START);
	const endIdx = existing.indexOf(BACKREF_END);
	if (startIdx === -1 || endIdx === -1) return existing;
	const before = existing.slice(0, startIdx).replace(/\s*$/, "");
	const after = existing.slice(endIdx + BACKREF_END.length).replace(/^\s*/, "");
	if (before.length === 0 && after.length === 0) return undefined;
	if (before.length === 0) return after;
	if (after.length === 0) return before;
	return `${before}\n\n${after}`;
}

function hasBackrefMarkers(s: string): boolean {
	return s.includes(BACKREF_START) && s.includes(BACKREF_END);
}

function replaceBackrefSection(existing: string, block: string): string {
	const startIdx = existing.indexOf(BACKREF_START);
	const endIdx = existing.indexOf(BACKREF_END);
	if (startIdx === -1 || endIdx === -1) return block;
	const before = existing.slice(0, startIdx);
	const after = existing.slice(endIdx + BACKREF_END.length);
	return `${before}${block}${after}`;
}

function approachExcerpt(value: unknown): string {
	if (typeof value !== "string") return "";
	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) return "";
	if (collapsed.length <= APPROACH_EXCERPT_MAX) return collapsed;
	const slice = collapsed.slice(0, APPROACH_EXCERPT_MAX);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > APPROACH_EXCERPT_MAX / 2 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}
