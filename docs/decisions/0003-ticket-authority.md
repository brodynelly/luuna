# ADR 0003: Missions ticket authority and SQLite execution state

Date: 2026-10-16. Status: accepted.

## Context

The original architecture assigns work records to Seeds, while the desktop proposal lists SQLite ticket tables. Two writable copies would allow stale approvals and lost updates when tickets are edited outside Luuna. Luuna Missions is the maintained Seeds-derived tool.

## Decision

After integration, Missions is authoritative for ticket intent, acceptance criteria, dependencies, and source revision. Luuna writes those fields through a serialized adapter with optimistic revision checks. SQLite stores a derived ticket projection and is authoritative for Luuna's immutable plans, approvals, runs, attempts, evidence, events, and publication state.

A minimal local SQLite ticket record is allowed for M0/M1 before the Missions adapter exists. It must be identified as temporary and must not claim external synchronization. Migration/reconciliation must preserve identifiers and revisions before enabling the adapter. Do not enable independent writes to both stores.

## Consequences and validation

Bind a plan to a ticket source revision. Detect external edits and reject stale writes or scheduling until reconciled; do not silently overwrite them. Adapter tests must cover duplicate delivery, revision conflict, unavailable Missions, and recovery after an uncertain write. An external ticket status is not evidence that a Luuna execution gate passed.
