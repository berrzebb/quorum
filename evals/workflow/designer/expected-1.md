# Expected: Design Document Generation

## Procedure Steps

1. Read PRD to extract FR/NFR requirements
2. Read DRM to confirm which artifacts are required (Spec, Blueprint, Domain Model, Architecture)
3. Run `quorum tool code_map` and `quorum tool dependency_graph` for codebase context
4. Generate Spec with:
   - Input/output/validation/error per FR
   - sequenceDiagram for JWT refresh flow
   - sequenceDiagram for RBAC middleware chain
   - sequenceDiagram for session management
5. Generate Blueprint with:
   - Module dependency flowchart showing auth modules
   - Interface contracts (Auditor-style method signatures)
   - Naming conventions table (AuthService, SessionStore, RBACMiddleware, etc.)
6. Generate Domain Model with:
   - erDiagram showing Session, User, Role, Permission entities
   - stateDiagram-v2 for session lifecycle (created → active → expired → revoked)
   - Entity definitions with field lists
7. Generate Architecture with:
   - System topology diagram (architecture-beta or flowchart)
   - Data flow table (token refresh flow, RBAC check flow)
   - Infrastructure component justifications
8. Run `quorum tool blueprint_lint` on the Blueprint
9. Verify all required diagrams exist per artifact
10. Output completeness report
