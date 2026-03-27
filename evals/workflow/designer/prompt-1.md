# Design Document Generation

Generate design documents for the "auth-refactor" track.

## Context

- PRD exists at `plans/auth-refactor/PRD.md` with FR-1 (JWT token refresh), FR-2 (RBAC middleware), FR-3 (session management)
- DRM requires: Spec (req), Blueprint (req), Domain Model (req), Architecture (req)
- Track has 5 WB items and involves persistence (session store) and API surface (auth endpoints)
- Codebase uses TypeScript, SQLite for state, Express for HTTP

Generate all 4 design artifacts with appropriate mermaid diagrams and validate completeness.
