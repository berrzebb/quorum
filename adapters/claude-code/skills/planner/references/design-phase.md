# Design Phase Guide

## Purpose

After PRD confirmation and before Work Breakdown generation, produce 4 design artifacts that define **how** to build what the PRD specifies. These artifacts establish the "laws" that implementers must follow.

## When to Apply

- **Always** for new product/feature tracks with 5+ WB items
- **Selectively** for smaller tracks — at minimum produce Spec + Architecture

## Location

`{planning_dir}/{track-name}/design/` — one directory per track.

## 4 Artifacts

### 1. Spec (Technical Specification)

Translates FR/NFR acceptance criteria into technical terms.

```markdown
# Technical Spec: {Track Name}

## FR-1: {Title}
- **Input**: HTTP POST /api/restaurants, body: { name, location, category }
- **Output**: 201 Created, body: { id, name, location, category, createdAt }
- **Validation**: name required (1-100 chars), location required (lat/lng), category enum
- **Error responses**: 400 (validation), 409 (duplicate name), 500 (server error)
- **Performance**: p95 < 200ms
```

Each FR maps to a concrete input/output/validation/error specification.

### 2. Blueprint (Module & Interface Design)

Defines modules, their interfaces, and contracts between them.

```markdown
# Blueprint: {Track Name}

## Module Map
| Module | Responsibility | Exposes | Consumes |
|--------|---------------|---------|----------|
| RestaurantService | CRUD operations | createRestaurant(), getRestaurants() | Database |
| LocationService | GPS tracking | trackDriver(), getLocation() | GPS API |

## Interface Contracts
| Interface | Method | Signature | Notes |
|-----------|--------|-----------|-------|
| IRestaurantService | create | (input: CreateRestaurantInput) => Promise<Restaurant> | Throws ValidationError |

## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| Restaurant list | `Restaurants` | Plural noun, not RestaurantList — per Definition law |
```

**The Naming Conventions table is critical** — it removes subjective naming decisions from implementers.

### 3. Domain Model

Defines core domain objects and their relationships.

```markdown
# Domain Model: {Track Name}

## Entities
| Entity | Key Fields | Relationships |
|--------|-----------|--------------|
| Restaurant | id, name, location, category | has many Orders |
| Order | id, customerId, restaurantId, status | belongs to Restaurant, Customer |

## Value Objects
| Name | Fields | Used By |
|------|--------|---------|
| Location | lat, lng | Restaurant, Driver |

## State Machines
| Entity | States | Transitions |
|--------|--------|------------|
| Order | created → accepted → preparing → delivering → delivered | Only forward transitions |
```

### 4. Architecture

Defines system topology and data flow.

```markdown
# Architecture: {Track Name}

## System Diagram
[Describe components and connections — can reference external diagram tools]

## Data Flow
| Flow | Source → Target | Protocol | Data |
|------|----------------|----------|------|
| Order creation | Customer App → API Server | REST | CreateOrderRequest |
| Location update | Driver App → Location Service | WebSocket | { driverId, lat, lng } |

## Infrastructure
| Component | Technology | Justification |
|-----------|-----------|--------------|
| Database | PostgreSQL | Relational data, ACID required |
| Cache | Redis | Session + location caching |
```

## DRM Integration

Add Design artifacts to the Document Requirement Matrix:

| Document | Condition | Trigger |
|----------|-----------|---------|
| Spec | Always for tracks with API surface | FR mentions endpoint, input, output |
| Blueprint | Always for tracks with 3+ modules | FR spans multiple components |
| Domain Model | When persistence involved | FR mentions entity, state, relationship |
| Architecture | When infrastructure decisions needed | FR mentions service, protocol, deployment |

## Rules

1. **Design before WB** — Work Breakdowns reference Design artifacts, not the reverse
2. **Naming is law** — Blueprint naming conventions are binding for all implementers
3. **Interfaces are contracts** — Changing an interface requires an Amendment (majority vote)
4. **State machines are exhaustive** — Every valid transition must be listed; unlisted = forbidden
5. **Design artifacts are living documents** — Updated via Amendment process when requirements change

## Anti-Patterns

- Do NOT write Design artifacts that repeat PRD — Design adds technical precision
- Do NOT leave naming decisions to implementers — decide in Blueprint
- Do NOT skip Domain Model for data-heavy tracks — it prevents schema confusion
- Do NOT design Architecture without considering NFRs — performance/security constraints drive technology choices
