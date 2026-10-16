# ADR 0001: desktop-first delivery with one runtime

Date: 2026-10-16. Status: accepted.

## Context

The original reference starts with browser/TUI clients. The later desktop proposal chooses Tauri while preserving full-v1 capabilities. Without a delivery decision, implementations could create competing backends or claim client parity too early.

## Decision

Deliver Tauri 2 with React/TypeScript first. Keep authoritative policy in a separate Rust service, using Tokio, Axum, and SQLite. Pi RPC supplies the agent engine; Luuna does not implement a competing model/tool loop. Shared HTTP contracts and event semantics must allow future browser and TUI clients.

Browser/TUI capability parity remains a full-v1 requirement. Desktop-first changes sequence, not that obligation. A single-repository foundation is M0/M1 evidence, not full-v1 completion.

## Alternatives and consequences

A browser-first client remains feasible later. A Tauri-only business layer would couple policies to a client and is rejected. Do not fork OpenCode for the initial implementation. Prove a real Pi vertical slice before expanding orchestration or UI scope. Native desktop builds and distribution require platform evidence beyond frontend compilation.
