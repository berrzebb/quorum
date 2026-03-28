# Sequence Diagram

## Participants & Actors

```mermaid
sequenceDiagram
  participant A as Alice
  actor B as Bob
```

### Typed Participants

```
participant {"type": "boundary", "label": "API Gateway"}
participant {"type": "database", "label": "PostgreSQL"}
participant {"type": "queue", "label": "Message Queue"}
participant {"type": "entity", "label": "User"}
participant {"type": "control", "label": "Controller"}
participant {"type": "collections", "label": "Cache"}
```

### Grouping (Box)

```mermaid
sequenceDiagram
  box Aqua Backend
    participant API
    participant DB
  end
  box rgb(33,66,99) External
    participant Webhook
  end
```

## Message Arrow Types

```
A ->> B        %% Solid arrow
A -->> B       %% Dotted arrow
A <<->> B      %% Bidirectional (v11.0.0+)
A <<-->> B     %% Dotted bidirectional
A -x B         %% Solid with cross (lost)
A --x B        %% Dotted with cross
A -) B         %% Async open arrow
A --) B        %% Dotted async
```

### Half-Arrows (v11.12.3+)

```
A -|\ B        %% Top half arrowhead
A -|/ B        %% Bottom half arrowhead
```

### Central Connections (v11.12.3+)

```
Alice ->>() communicate: Broadcasting
```

## Activation

```mermaid
sequenceDiagram
  Alice ->>+ Bob: Request        %% + activates
  Bob ->>+ DB: Query
  DB -->>- Bob: Result           %% - deactivates
  Bob -->>- Alice: Response
```

## Notes

```
Note right of Alice: Single side
Note left of Bob: Other side
Note over Alice,Bob: Spanning note
```

Line breaks: `Note right of A: Line 1<br/>Line 2`

## Control Flow

### Loop

```mermaid
sequenceDiagram
  loop Every 30s
    Client ->> API: heartbeat
  end
```

### Alt / Else

```mermaid
sequenceDiagram
  alt cache hit
    API -->> Client: 200 (cached)
  else cache miss
    API ->> DB: query
    DB -->> API: rows
    API -->> Client: 200 (fresh)
  end
```

### Opt (if without else)

```
opt has webhook
  API -) Webhook: notify
end
```

### Par (parallel)

```mermaid
sequenceDiagram
  par Alice to Bob
    Alice ->> Bob: Task 1
  and Alice to John
    Alice ->> John: Task 2
  end
```

### Critical / Option

```
critical Must succeed
  Alice ->> Bob: Critical op
option Timeout
  Alice ->> Bob: Retry
end
```

### Break

```
break Connection lost
  Bob -->> Alice: Error
end
```

### Rect (background highlight)

```
rect rgba(0, 0, 255, .1)
  Alice ->> Bob: Highlighted
end
```

## Autonumber

```mermaid
sequenceDiagram
  autonumber
  Alice ->> Bob: Step 1
  Bob -->> Alice: Step 2
```

## Create / Destroy (v10.3.0+)

```mermaid
sequenceDiagram
  create participant B
  A ->> B: Created
  destroy B
  B ->> A: Goodbye
```

## Actor Menus (links)

```
link Alice: Dashboard @ https://dashboard.example.com
links Alice: {"Wiki": "https://wiki.example.com"}
```

## Comments

```
%% This is a comment
```
