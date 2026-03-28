---
name: quorum-mcp-builder
description: "Guide for building high-quality MCP (Model Context Protocol) servers. Covers TypeScript and Python, from planning to evaluation. Use when creating MCP servers, adding MCP tools, integrating external APIs via MCP, or building tool servers for LLMs. Triggers on 'MCP server', 'MCP tool', 'build MCP', 'create tool server', 'Model Context Protocol', 'MCP 서버', 'MCP 도구', '도구 서버 만들기'."
argument-hint: "<service name or API to integrate>"
model: codex
allowed-tools: read_file, write_file, apply_diff, find_files, search, shell
---

# MCP Server Builder (Codex)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `platform/skills/mcp-builder/SKILL.md`.
