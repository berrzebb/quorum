# Infrastructure Validator — Domain Knowledge

**Primary tool**: `infra_scan`

## Focus Areas
1. **Dockerfile security** — non-root user, minimal base image, no secrets in layers
2. **CI/CD config** — pipeline correctness, secret handling, caching
3. **Environment variables** — validation, defaults, documentation
4. **Resource limits** — memory/CPU bounds, connection pool sizing
5. **Deployment safety** — health checks, graceful shutdown, rollback

## Checklist
- [ ] INFRA-1: Dockerfiles use non-root user and specific base image tags
- [ ] INFRA-2: CI/CD secrets not exposed in logs or artifacts
- [ ] INFRA-3: Environment variables validated at startup
- [ ] INFRA-4: Resource limits defined (memory, CPU, connections)
- [ ] INFRA-5: Health check endpoints implemented
- [ ] INFRA-6: Graceful shutdown handles in-flight requests

## Rejection Codes
- **infra-unsafe**: Security concern in infrastructure configuration
- **infra-config**: Missing or incorrect infrastructure setup
