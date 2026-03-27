# Nestfolio

## Agent Documentation System

This repo uses an agent documentation system for Claude Code agents.
See [docs/agent-system.md](docs/agent-system.md) for details.

### Quick Start

| Command | What it does |
|---------|-------------|
| `/init-docs` | Regenerate all service cards, flow specs, and run a full system audit. Run after major refactors or on first clone. |
| `/audit-service` | Audit and regenerate a single service's documentation card. |
| `/audit-system` | Full system verification sweep across all 4 domains. |
| `/validate-flow` | Validate a flow spec against actual code. |
