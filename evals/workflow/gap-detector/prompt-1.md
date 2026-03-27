# Gap Detection for Auth Track

Check design-implementation gaps for the "auth-refactor" track.

## Context

- Design documents exist at `plans/auth-refactor/design/`
  - spec.md defines 3 API endpoints with input/output types
  - blueprint.md defines AuthService, SessionStore, RBACMiddleware modules
  - domain-model.md defines User, Session, Role entities
- Implementation is in `src/auth/`
- Some endpoints may have been added that aren't in the design (Extra)
- Some design interfaces may not yet be implemented (Missing)
