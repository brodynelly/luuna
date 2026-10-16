---
name: seeds-issue-workflow
description: Turn a request into tracked, ready seeds work — file an issue with priority and labels, wire dependencies, and decompose large work into structured child seeds with sd plan. Use when an agent needs to create or organize work in the seeds repo.
tools:
  - sd
  - git
inputs:
  - a description of the work (a sentence or a multi-step feature)
outputs:
  - one or more seeds in .seeds/issues.jsonl, ready (unblocked) or correctly blocked
  - for large work, a plan row in .seeds/plans.jsonl with one child seed per step
---

# seeds-issue-workflow

Use this skill inside the seeds repo when you need to turn a vague ask
into a tracked unit of work that `sd ready` will surface. It encodes
two procedures: **create-then-ready** for a single scoped task, and
**plan-decomposition** for work large or ambiguous enough that an LLM
benefits from structured breakdown first.

## Pre-flight

```bash
sd prime                          # inject rules + command reference
sd ready                          # see what is already unblocked
sd search "<keywords>"            # avoid filing a duplicate
```

If a seed already covers the work, claim it
(`sd update <id> --status in_progress`) instead of filing a new one.

## Procedure A — create-then-ready (single scoped task)

For a task that fits in one focused commit:

```bash
sd create --title "Fix sd close race on concurrent writers" \
  --type bug --priority 1 \
  --description "Two agents closing the same id can drop one update."
```

Capture the printed id (e.g. `seeds-1a2b`), then tag and wire it:

```bash
sd label add seeds-1a2b concurrency
sd dep add seeds-1a2b seeds-9f8e   # this work depends on seeds-9f8e first
```

A seed is **ready** when it is open and every id in its `blockedBy`
list is closed. Add dependencies for real ordering only — every
unnecessary `sd dep add` hides the work from `sd ready`. Verify:

```bash
sd ready | grep seeds-1a2b        # appears once its blockers close
```

## Procedure B — plan-decomposition (large / ambiguous work)

When the work is multi-step, emit a structured prompt, fill it, and let
seeds spawn the children:

```bash
sd plan prompt seeds-1a2b > /tmp/plan.json   # emit the template to fill
$EDITOR /tmp/plan.json                       # write one step per unit of work
sd plan submit seeds-1a2b --plan /tmp/plan.json
```

Each step becomes one child seed; a step's `blocks: [j]` wires step
`i`'s id into step `j`'s `blockedBy`, so the children come out in
dependency order. Steps may carry `labels: [...]` that flow to the
spawned child (normalized and merged additively). Inspect and track:

```bash
sd plan show <pl-id>              # sections, children, sub-plans
sd ready                          # the first unblocked child surfaces
```

## Finish

Close completed work and sync before handing off:

```bash
sd close seeds-1a2b --reason "Fixed; covered by store.test.ts"
sd sync                           # stage + commit .seeds/ changes
```

Do not `git push` unless the user asks. Never hand-edit
`.seeds/issues.jsonl` — always go through `sd` so advisory locks and
atomic writes are honored.
