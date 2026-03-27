# Planner Eval Prompt

Design a user authentication feature with login, registration, and password reset.

## Context

You are working on a Node.js/Express backend application. The project uses TypeScript, JWT for session management, and PostgreSQL for persistence.

## Requirements

- User registration with email and password
- Login endpoint returning JWT access and refresh tokens
- Password reset flow via email verification link
- Input validation and rate limiting on auth endpoints
- Secure password hashing (bcrypt)
- Account lockout after 5 failed login attempts

## Instructions

Generate a complete PRD (Product Requirements Document) and Work Breakdown (WB) items for this authentication feature. Follow the quorum planner protocol:

1. Phase 0: CPS Intake (if applicable)
2. Phase 1: Intent Extraction
3. Phase 1.5: MECE Decomposition (Actor → System → Domain)
4. Phase 2-4: PRD Generation (Goals / Requirements / Scope / Constraints)
5. Phase 5: Design Phase (naming conventions)
6. Phase 5.5: FDE Failure Checklists per FR
7. Phase 6: Work Breakdown generation with Phase/GATE hierarchy
