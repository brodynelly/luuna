import { StatusBadge } from "./design/StatusBadge";
import { TONES, candidateTone, runTone } from "./design/tone";
import type { Tone } from "./design/tone";

/** The repository the desktop is built from; its documents are linked from the Help panel. */
export const REPOSITORY_URL = "https://github.com/brodynelly/luuna/blob/main";

export const ONBOARDING_STEPS: readonly { title: string; detail: string }[] = [
  { title: "Connect to the runtime", detail: "The native shell starts the local runtime and connects; the web build takes the loopback address and the service token, which stays in memory. The topbar's connection status is the only green that is not evidence." },
  { title: "Register a project", detail: "Register every related repository by its absolute root path. The runtime observes identity, HEAD and dirty state read-only; paths stay in this machine's registry." },
  { title: "Discover and confirm the manifest", detail: "Discovery proposes check recipes and relationships from manifests and lockfiles without running anything. Confirming records an immutable manifest revision bound to the exact base commits." },
  { title: "Establish the baseline", detail: "Run a baseline per repository: its confirmed required recipes on the developer checkout, recorded as exact evidence. A repository with no required check, or whose checks execute no test, is offered the testing-setup prerequisite: a testing_setup ticket whose plan proposes the recipes, approved and implemented like any plan; once its candidate is reviewed you merge it, confirm the recipes and run a passing baseline." },
  { title: "Create and plan a ticket", detail: "A ticket names the intent and acceptance criteria. A plan revision is immutable: its tasks (with roles, dependencies and any justified dependency override), permissions, checks and budgets hash together." },
  { title: "Approve the exact plan", detail: "Review the complete plan and acknowledge its hash. Approval binds to exactly that revision; an edited ticket or a changed manifest stales it." },
  { title: "Implement in a managed worktree", detail: "The approved writer runs in a Luuna-owned worktree with the approved paths; the developer checkout is never reset. A failed, blocked or interrupted task of a settled graph can be resumed under the same approval." },
  { title: "Validate and review", detail: "The required checks run in the candidate worktree and a fresh independent reviewer records structured findings; both bind to the exact candidate hash. Repairs are bounded by the approved budgets." },
  { title: "Publish", detail: "A reviewed candidate pushes its exact commits and opens linked pull requests. Merging stays with you; Luuna never merges." },
];

const TONE_MEANING: Record<Tone, string> = {
  success: "Passed durable evidence: a passed check, baseline or review verdict, a reviewed candidate, a live connection. Green is earned; a completed session is not a validation result.",
  active: "The runtime is working (a writer, checks, a reviewer, a baseline). Cancellation is available while it is.",
  danger: "Failed or blocked evidence: a failed check or run, a blocked baseline, a verdict that requires changes, a blocking finding.",
  attention: "Waiting on you: a plan to approve, an approved plan to implement, a paused candidate, an unconfirmed project, an inferred recipe, a testing-setup offer.",
  neutral: "Recorded, not evidence: queued, completed, cancelled, discovered; a pending candidate; a released lease.",
  interrupted: "Stopped by an outage or a restart, recoverable: the work is durable and its worktree is kept.",
};

/** Every run and candidate value a tone carries, from the same maps the badges use. */
export function statesForTone(tone: Tone): string[] {
  const values = new Set<string>();
  for (const [state, mapped] of Object.entries(runTone)) if (mapped === tone) values.add(`run ${state.replace(/_/g, " ")}`);
  for (const [state, mapped] of Object.entries(candidateTone)) if (mapped === tone) values.add(`candidate ${state.replace(/_/g, " ")}`);
  return [...values];
}

export const EVIDENCE_LOCATIONS: readonly { where: string; what: string }[] = [
  { where: "Projects › Recorded baselines", what: "Each baseline with its manifest revision, exact commit, per-recipe result and the stdout/stderr log of every recipe; a blocked baseline carries the testing-setup offer." },
  { where: "Projects › Project event record", what: "The durable, sequenced project events: registrations, discoveries, manifest confirmations, baselines, offers." },
  { where: "Ticket › Complete immutable plan", what: "The sealed plan revision with its hash, tasks, roles, dependency overrides, required recipes, budgets and selected component resources." },
  { where: "Ticket › Candidate", what: "The candidate hash, per-repository commits and trees, each check's command, exit code, environment fingerprint and logs, the independent review with its findings, workflow usage, and for a setup workflow the handoff." },
  { where: "Ticket › Task graph", what: "Per-task state, exact candidate commit, who assigned it (the approval of the exact plan revision), what it derives from, the overrides that name it, and an advisory task's findings, proposed tasks and risks." },
  { where: "Ticket › Worktrees and the editor handoff", what: "The Luuna-owned worktree path of each lease; the candidate view shows the path to open in your editor and copies it. Opening it transfers no permission." },
  { where: "Session events", what: "The run's durable event record with cursor replay after any interruption." },
  { where: "Project components", what: "Tickets in Missions, scoped memory with provenance in Atlas, versioned prompts in Beacon; retention and the personal export." },
];

export const DOCUMENTS: readonly { path: string; title: string }[] = [
  { path: "AI-START-HERE.md", title: "Start here: how the repository is organised" },
  { path: "docs/MVP-WALKTHROUGH.md", title: "The walkthrough: import, baseline, ticket, plan, writer, validation, review" },
  { path: "docs/09-experience.md", title: "User experience: views, parity, lifecycle" },
  { path: "docs/08-validation.md", title: "Validation: baselines, the testing prerequisite, checks and review" },
  { path: "docs/CURRENT-ARCHITECTURE.md", title: "Current architecture and what is authoritative" },
  { path: "docs/DESIGN-SYSTEM.md", title: "The desktop design system: tones, components, accessibility" },
  { path: "docs/decisions/0022-testing-setup-prerequisite.md", title: "ADR 0022: the testing-setup prerequisite workflow" },
  { path: "docs/decisions/0023-delegated-roles-and-dependency-overrides.md", title: "ADR 0023: roles, assignment traces and dependency overrides" },
  { path: "docs/decisions/0027-v1-advertised-scope.md", title: "ADR 0027: the advertised v1 scope, including these surfaces" },
  { path: "packages/tui/README.md", title: "The terminal client: the same actions and projections" },
];

/** The Help panel of docs/09-experience.md (ADR 0027 point 4): onboarding, what each state means, where evidence lives, and the documents. Static; it decides nothing. */
export function Help() {
  return <section className="panel help-panel" aria-labelledby="help-heading" data-surface="help">
    <div className="panel-heading"><h2 id="help-heading">Help</h2><span className="tag">Onboarding · states · evidence · documents</span></div>
    <p className="scope">How the workbench is used, what each state badge means, where the runtime keeps its evidence, and the repository documents that specify it. The runtime decides every state and next step; this page only explains them.</p>
    <div className="help-sections">
      <section className="help-section" aria-labelledby="help-onboarding"><h3 id="help-onboarding">Onboarding</h3>
        <ol>{ONBOARDING_STEPS.map((step) => <li key={step.title}><strong>{step.title}.</strong> {step.detail}</li>)}</ol>
      </section>
      <section className="help-section" aria-labelledby="help-states"><h3 id="help-states">What each state means</h3>
        <dl className="help-states">{TONES.map((tone) => <div key={tone}>
          <dt><StatusBadge tone={tone}>{tone}</StatusBadge><span>{statesForTone(tone).join(", ") || "connection and chips only"}</span></dt>
          <dd>{TONE_MEANING[tone]}</dd>
        </div>)}</dl>
      </section>
      <section className="help-section" aria-labelledby="help-evidence"><h3 id="help-evidence">Where evidence lives</h3>
        <ul>{EVIDENCE_LOCATIONS.map((location) => <li key={location.where}><strong>{location.where}.</strong> {location.what}</li>)}</ul>
      </section>
      <section className="help-section" aria-labelledby="help-documents"><h3 id="help-documents">Documents</h3>
        <ul className="help-plain">{DOCUMENTS.map((document) => <li key={document.path}><a href={`${REPOSITORY_URL}/${document.path}`} target="_blank" rel="noreferrer">{document.title}</a> <code>{document.path}</code></li>)}</ul>
      </section>
    </div>
  </section>;
}
