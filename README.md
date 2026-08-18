# Composio 100-App Research Case Study

Phase 1 establishes the TypeScript/Node.js foundation for an evidence-backed research pipeline. Research-agent, verification, analysis, and HTML-report implementations are intentionally not included yet.

## Prerequisites

- Node.js 20.11 or newer
- npm

## Setup

```bash
npm install
cp .env.example .env
```

`COMPOSIO_API_KEY` is optional in this phase. It will be required only for future live Composio operations.

## Available commands

```bash
npm run dev
npm run build
npm run typecheck
npm test
npm run check
```

## Project layout

- `src/` — application modules, grouped by pipeline responsibility.
- `data/raw/` — unnormalized cached source material; not committed.
- `data/processed/` — generated normalized artifacts; not committed.
- `output/` — generated deliverables; not committed.
- `public/` — future static report assets.
- `scripts/` — future operational scripts.
- `tests/` — automated tests and fixtures.

The repository rules and research-quality requirements are defined in [AGENTS.md](AGENTS.md).
