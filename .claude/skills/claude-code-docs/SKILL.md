---
name: claude-code-docs
description: >
  Fetch current Claude Code documentation before answering questions or making decisions
  about Claude Code features. Use when working with skills, commands, hooks, settings,
  agents, subagents, MCP servers, plugins, permissions, CLAUDE.md, or any .claude/ configuration.
  Also use when setting up or restructuring project configuration for Claude Code.
user-invocable: false
---

## STOP — Your training data may be outdated

Claude Code evolves rapidly. Before making ANY claim about how a Claude Code feature works,
you MUST fetch the current documentation. Do not rely on training data.

## What to fetch

Use `ctx_fetch_and_index` (or `WebFetch` if unavailable) to load the relevant page:

| Topic | URL |
|-------|-----|
| Skills | https://code.claude.com/docs/en/skills |
| Hooks | https://code.claude.com/docs/en/hooks-guide |
| Settings | https://code.claude.com/docs/en/settings |
| Subagents | https://code.claude.com/docs/en/sub-agents |
| Agent teams | https://code.claude.com/docs/en/agent-teams |
| MCP servers | https://code.claude.com/docs/en/mcp |
| Plugins | https://code.claude.com/docs/en/plugins |
| Permissions | https://code.claude.com/docs/en/permissions |
| Memory / CLAUDE.md | https://code.claude.com/docs/en/memory |
| CLI reference | https://code.claude.com/docs/en/cli-reference |
| Commands (built-in) | https://code.claude.com/docs/en/commands |
| Scheduled tasks | https://code.claude.com/docs/en/scheduled-tasks |
| Headless / programmatic | https://code.claude.com/docs/en/headless |

## Rules

1. Fetch BEFORE answering — never answer from memory alone
2. If multiple topics are relevant, fetch multiple pages
3. After fetching, use `ctx_search` to find specific details
4. If a feature doesn't appear in the docs, it likely doesn't exist — say so
5. When the fetched docs contradict your training data, trust the docs
