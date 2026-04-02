# infra_scan

Scan infrastructure files for security and reliability anti-patterns.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Project root to scan (default: cwd) |

## Example

```bash
quorum tool infra_scan --path .
```

## What It Checks

- Dockerfile: running as root, no health check, large base images
- CI configs: missing secret masking, insecure artifact handling
- docker-compose: exposed ports, missing resource limits
- Environment files: secrets in plain text
