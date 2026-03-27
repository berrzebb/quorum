---
name: quorum-mcp-builder
description: "Guide for building high-quality MCP (Model Context Protocol) servers. Covers TypeScript and Python, from planning to evaluation. Use when creating MCP servers, adding MCP tools, integrating external APIs via MCP, or building tool servers for LLMs. Triggers on 'MCP server', 'MCP tool', 'build MCP', 'create tool server', 'Model Context Protocol', 'MCP 서버', 'MCP 도구', '도구 서버 만들기'."
argument-hint: "<service name or API to integrate>"
allowed-tools: read, write, edit, glob, grep, bash
---

# MCP Server Builder (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Edit file | `edit` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `skills/mcp-builder/SKILL.md`.
