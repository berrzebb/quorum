# State Diagram

## Declaration

```
stateDiagram-v2
```

## States

```
s1                           %% Simple ID
state "Description" as s1    %% With keyword
s1: State Description        %% Colon notation
```

## Transitions

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Processing : submit
  Processing --> Done : success
  Processing --> Error : failure
  Error --> Idle : retry
  Done --> [*]
```

`[*]` = start/end state

## Composite States

```mermaid
stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Editing
    Editing --> Reviewing : submit
    Reviewing --> Editing : reject
    Reviewing --> Approved : approve
  }
  Active --> Archived : archive
```

Multi-layer nesting supported.

## Fork / Join (Parallel)

```mermaid
stateDiagram-v2
  state fork_state <<fork>>
  state join_state <<join>>
  [*] --> fork_state
  fork_state --> Validate
  fork_state --> Transform
  Validate --> join_state
  Transform --> join_state
  join_state --> Complete
```

## Choice

```mermaid
stateDiagram-v2
  state check <<choice>>
  [*] --> check
  check --> Approved : score >= 80
  check --> Rejected : score < 80
```

## Concurrency

```mermaid
stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Task1
    --
    [*] --> Task2
  }
```

`--` separates concurrent regions.

## Notes

```
note right of Processing
  Runs async audit pipeline.
  Max 3 correction rounds.
end note
```

## Direction

```
stateDiagram-v2
  direction LR    %% LR, RL, TB, BT
```

## Styling

```
classDef alert fill:#f00,color:#fff,font-weight:bold
class ErrorState alert
StateA:::alert --> StateB
```

## Constraint

Transitions between internal states of different composite states are not allowed.
