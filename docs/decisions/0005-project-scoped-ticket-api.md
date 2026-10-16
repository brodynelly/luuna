# ADR 0005: project-scoped ticket creation

Date: 2026-10-16. Status: accepted.

## Context

The original API uses project-scoped creation, while the desktop proposal includes a global `/tickets` example and asks the implementer to choose one route. Implementing both without a contract would introduce ambiguous ownership and duplicate behavior.

## Decision

Use **`POST /api/v1/projects/{id}/tickets`** as the single canonical create-ticket route. Resolve and validate project identity from the path; reject conflicting body identity or unknown repositories. Subsequent operations may address global ticket IDs, such as `POST /api/v1/tickets/{id}/plans`.

The runtime applies authentication, input validation, an idempotency key for repeatable delivery, and ticket revision guards where appropriate. Before Missions integration, persistence follows the temporary model in ADR 0003; afterward creation goes through the Missions adapter.

## Consequences

Do not add `POST /api/v1/tickets` as a second creation route. Update generated contracts/clients from the implemented canonical route. Verify project isolation, malformed input, duplicate requests, and stale revisions as the API is implemented. This decision establishes a contract, not a claim that the endpoint already exists.
