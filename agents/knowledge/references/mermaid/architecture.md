# Architecture Diagram (Beta)

## Start

```
architecture-beta
```

## Groups

```
group <id>(<icon>)[Title]
group <id>(<icon>)[Title] in <parent_id>    %% Nested
```

## Services

```
service <id>(<icon>)[Title]
service <id>(<icon>)[Title] in <group_id>
```

## Edges

```
<id>:<side> --> <side>:<id>      %% Directional
<id>:<side> <-- <side>:<id>      %% Reverse
<id>:<side> --- <side>:<id>      %% Undirected (v11.4.1+)
```

Sides: `T` (top), `B` (bottom), `L` (left), `R` (right)

## Junctions (4-way connectors)

```
junction <id>
junction <id> in <group_id>
```

## Built-in Icons

`cloud`, `database`, `disk`, `internet`, `server`

Custom icons via iconify: `"fa6-solid:gear"`

## Full Example

```mermaid
architecture-beta
  group client(cloud)[Client Tier]
  group backend(server)[Backend Tier]
  group data(database)[Data Tier]

  service browser(internet)[Browser] in client
  service cdn(cloud)[CDN] in client
  service api(server)[API Server] in backend
  service worker(server)[Worker] in backend
  service queue(server)[Queue] in backend
  service pg(database)[PostgreSQL] in data
  service redis(database)[Redis] in data

  browser:R --> L:cdn
  cdn:B --> T:api
  api:R --> L:pg
  api:R --> L:redis
  api:B --> T:queue
  queue:R --> L:worker
  worker:R --> L:pg
```
