import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryCorrection, MemorySelection, PromptPreview, promptDeliveryAfterPreview, promptEditBody, promptRetryIdentity, retentionPolicyFromForm, retryIdentity } from "./ProjectComponents";
import type { MemoryRecord, RenderedPrompt } from "@luuna/api-client";

test("memory includes scope and provenance without implicitly selecting a private record", () => {
  const record: MemoryRecord = { id: "user-memory", scope: "user", content: "<script>private memory</script>", provenance: "A developer note", hash: "sha256:record" };
  const html = renderToStaticMarkup(<MemorySelection records={[record]} selected={[]} busy={false} onToggle={() => { throw new Error("No implicit selection"); }} onDelete={() => {}} />);
  expect(html).toContain("Private user memory");
  expect(html).toContain("A developer note");
  expect(html).toContain("Include this memory in the next plan");
  expect(html).not.toContain("checked=");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

test("prompt preview presents the exact version, body and hash before explicit selection", () => {
  const prompt: RenderedPrompt = { name: "writer-guidance", version: 3, hash: "sha256:exact-resource", body: "Keep the approved scope." };
  const html = renderToStaticMarkup(<PromptPreview prompt={prompt} selected={false} busy={false} onSelect={() => { throw new Error("No implicit selection"); }} />);
  expect(html).toContain("version 3");
  expect(html).toContain("Keep the approved scope.");
  expect(html).toContain("sha256:exact-resource");
  expect(html).toContain("Use this prompt in next plan");
  expect(html).toContain('aria-pressed="false"');
});

test("retrying an uncertain delivery reuses its identity until the submitted content changes", () => {
  const first = retryIdentity(null, "same record", () => "first-delivery");
  expect(retryIdentity(first, "same record", () => { throw new Error("Must reconcile the same delivery"); })).toBe(first);
  expect(retryIdentity(first, "different record", () => "second-delivery").key).toBe("second-delivery");
  expect(retryIdentity(null, "same record", () => "after-success").key).toBe("after-success");
});

test("an uncertain prompt retry keeps its key and expected version after a list refresh", () => {
  const first = promptRetryIdentity(null, "same prompt", 1, () => "first-delivery");
  expect(promptRetryIdentity(first, "same prompt", 2, () => { throw new Error("Must reconcile the initial prompt write"); })).toBe(first);
  expect(first.expectedVersion).toBe(1);
  expect(promptRetryIdentity(first, "edited prompt", 2, () => "edited-delivery")).toEqual({ content: "edited prompt", expectedVersion: 2, key: "edited-delivery" });
  expect(promptRetryIdentity(null, "same prompt", 2, () => "after-success").key).toBe("after-success");
  expect(promptDeliveryAfterPreview(first, 2)).toBe(first);
  expect(promptDeliveryAfterPreview({ ...first, refused: true }, 2)).toBeNull();
  const refused = { ...first, refused: true };
  expect(promptDeliveryAfterPreview(refused, 1)).toBe(refused);
});

test("editing a rendered guidance prompt does not nest the runtime's section wrapper", () => {
  expect(promptEditBody("## guidance\nUse the approved scope.\n")).toBe("Use the approved scope.");
  expect(promptEditBody("An unwrapped prompt")).toBe("An unwrapped prompt");
});

test("a memory correction is offered per record and saves only changed content at the displayed hash", () => {
  const record: MemoryRecord = { id: "mem-1", scope: "project", content: "tests use unittest", provenance: "README", hash: `sha256:${"a".repeat(64)}` };
  const list = renderToStaticMarkup(<MemorySelection records={[record]} selected={[]} busy={false} onToggle={() => {}} onDelete={() => {}} onCorrect={() => {}} />);
  expect(list).toContain("Correct memory");
  expect(renderToStaticMarkup(<MemorySelection records={[record]} selected={[]} busy={false} onToggle={() => {}} onDelete={() => {}} />)).not.toContain("Correct memory");
  const form = renderToStaticMarkup(<MemoryCorrection record={record} busy={false} onSave={() => { throw new Error("no unchanged save"); }} onCancel={() => {}} />);
  expect(form).toContain('data-capability="memory.update"');
  expect(form).toContain(record.hash);
  expect(form).toContain("keeps its project scope");
  expect(form).toContain("can no longer be implemented until it is re-planned");
  // A submit button inside the form; the library leaves the default (submit) type implicit.
  expect(form).toMatch(/<button (?:type="submit" )?class="primary" disabled="" data-capability="memory.update">Save correction<\/button>/);
});

test("the retention form sends null for a scope that keeps its records", () => {
  expect(retentionPolicyFromForm("30", "")).toEqual({ process_max_age_days: 30, project_max_age_days: null });
  expect(retentionPolicyFromForm("", "")).toEqual({ process_max_age_days: null, project_max_age_days: null });
  expect(retentionPolicyFromForm(" ", "365")).toEqual({ process_max_age_days: null, project_max_age_days: 365 });
});
