# Composio 100-App Research Case Study

The current phase provides evidence-backed first-pass research for batches of applications, deterministic buildability scoring, and resumable run artifacts. Verification, analysis, and HTML-report generation remain future phases.

## Prerequisites

- Node.js 20.11 or newer
- npm

## Setup

```bash
npm install
cp .env.example .env
```

`COMPOSIO_API_KEY` is optional for local development and tests; it is required for live research commands.

Live research also requires `RESEARCH_RESULT_GENERATOR_MODULE`: an ESM module exporting either a default value or `resultGenerator`, each with an async `generate(input)` method that implements the `StructuredResearchResultGenerator` contract. This keeps model credentials and model-provider code outside the pipeline while preserving the evidence-validation boundary.

## Available commands

```bash
npm run dev
npm run build
npm run typecheck
npm test
npm run check
npm run research
npm run research -- --apps github,hubspot,shopify,stripe,slack
npm run research:single -- <app-id>
npm run research:resume
npm run composio:preflight
```

`research:resume` requires `RESEARCH_RUN_ID`; completed apps in that run are skipped, while errors are retried. Successful apps write raw model output, collected-source records, and normalized findings under `data/runs/<run-id>/`; failures write separate error artifacts. Each command prints total, successful, failed, retried, average confidence, and duration.

`--apps` accepts a comma-separated list of stable IDs or case-insensitive display names, validates every requested application before starting research, and de-duplicates repeated selections. The default command still processes all 100 apps.

`npm run composio:preflight` creates a non-research Composio session, verifies `COMPOSIO_SEARCH_TOOLS`, discovers a web-search tool dynamically, and executes a generic capability probe through `COMPOSIO_MULTI_EXECUTE_TOOL`. It records the returned tool slug, toolkit, and any schema lookup in research metadata. It never prints credentials or starts application research. Discovery and schema failures are non-retryable; a discovered tool execution failure is reported separately for diagnosis.

## Project layout

- `src/` — application modules, grouped by pipeline responsibility.
- `data/raw/` — unnormalized cached source material; not committed.
- `data/processed/` — generated normalized artifacts; not committed.
- `output/` — generated deliverables; not committed.
- `public/` — future static report assets.
- `scripts/` — future operational scripts.
- `tests/` — automated tests and fixtures.

The repository rules and research-quality requirements are defined in [AGENTS.md](AGENTS.md).
