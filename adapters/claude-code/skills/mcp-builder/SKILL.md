---
name: quorum:mcp-builder
description: "Guide for building high-quality MCP (Model Context Protocol) servers. Covers TypeScript and Python, from planning to evaluation. Use when creating MCP servers, adding MCP tools, integrating external APIs via MCP, or building tool servers for LLMs. Triggers on 'MCP server', 'MCP tool', 'build MCP', 'create tool server', 'Model Context Protocol', 'MCP 서버', 'MCP 도구', '도구 서버 만들기'."
argument-hint: "<service name or API to integrate>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(npm *), Bash(npx *)
---

# MCP Server Builder (Claude Code)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Edit file | `Edit` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/mcp-builder/SKILL.md`.
