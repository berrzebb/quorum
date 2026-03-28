---
name: quorum:mcp-builder
description: "Guide for building high-quality MCP (Model Context Protocol) servers. Covers TypeScript and Python, from planning to evaluation. Use when creating MCP servers, adding MCP tools, integrating external APIs via MCP, or building tool servers for LLMs. Triggers on 'MCP server', 'MCP tool', 'build MCP', 'create tool server', 'Model Context Protocol', 'MCP 서버', 'MCP 도구', '도구 서버 만들기'."
argument-hint: "<service name or API to integrate>"
---

# MCP Server Development Guide

Build MCP servers that enable LLMs to interact with external services through well-designed tools.

## 4-Phase Workflow

### Phase 1: Research & Plan

1. Study the target API — endpoints, auth, data models
2. Read `skills/mcp-builder/references/mcp-best-practices.md` for universal MCP guidelines
3. Choose language and read the implementation guide:
   - **TypeScript (recommended)**: `skills/mcp-builder/references/node-mcp-server.md`
   - **Python**: `skills/mcp-builder/references/python-mcp-server.md`
4. Plan tool list — prioritize comprehensive API coverage over workflow shortcuts

**Key design principles:**
- Clear, action-oriented tool names with consistent prefixes (`github_create_issue`)
- Concise descriptions that help agents find the right tool
- Actionable error messages with specific suggestions
- Paginated results for large datasets

### Phase 2: Implement

1. **Project structure** — see language-specific guide
2. **Shared infrastructure** — API client, auth, error handling, pagination
3. **Each tool needs:**
   - Input schema (Zod for TS, Pydantic for Python) with constraints and descriptions
   - Output schema (`outputSchema` / `structuredContent`) where possible
   - Async implementation with proper error handling
   - Annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`

**Transport selection:**
- Streamable HTTP (stateless JSON) — for remote servers
- stdio — for local servers

### Phase 3: Review & Test

- No duplicated code (DRY)
- Consistent error handling across all tools
- Full type coverage
- Build verification: `npm run build` (TS) or `python -m py_compile` (Python)
- Test with MCP Inspector: `npx @modelcontextprotocol/inspector`

### Phase 4: Evaluate

Create 10 complex, realistic questions to test LLM effectiveness with your tools.

Read `skills/mcp-builder/references/evaluation.md` for the complete evaluation framework.

**Requirements:** each question must be independent, read-only, multi-tool, realistic, verifiable, and stable.

## References

| Phase | Reference | When to read |
|-------|-----------|-------------|
| 1-2 | `references/mcp-best-practices.md` | Before starting — universal MCP guidelines |
| 2 | `references/node-mcp-server.md` | TypeScript implementation patterns |
| 2 | `references/python-mcp-server.md` | Python/FastMCP implementation patterns |
| 4 | `references/evaluation.md` | After implementation — testing framework |

## MCP Protocol Docs

- Sitemap: `https://modelcontextprotocol.io/sitemap.xml`
- Fetch specific pages with `.md` suffix for markdown format
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
