# Composio 100-App Research Case Study

## Project purpose

Build a production-quality, intentionally scoped TypeScript pipeline for a take-home assignment. The pipeline researches 100 applications, records evidence-backed findings, verifies them reproducibly, analyzes cross-app patterns, and produces a single self-explanatory HTML case study plus reproducible repository instructions.

The project is a batch research system, not a live dashboard. Its primary outputs are versioned research artifacts, verification artifacts, a final structured dataset, and `report/case-study.html`.

## Assignment requirements

The completed project must:

- Research exactly 100 selected applications using an agent and/or scripts, rather than manual-only collection.
- Use the current Composio SDK and/or Composio MCP where it materially helps. Do not use deprecated Composio APIs or legacy SDK patterns.
- Record, for every app:
  - category;
  - one-line description;
  - authentication methods;
  - whether developer credentials are self-serve or gated;
  - credential access type: free, trial, paid, admin-approved, partner-gated, contact-sales, or `UNKNOWN`;
  - public API surface: REST, GraphQL, webhooks, SDK-only, other, or none;
  - approximate API breadth;
  - MCP-server status;
  - whether it could be built as an agent toolkit today;
  - the main blocker when it cannot;
  - evidence URLs;
  - confidence; and
  - verification status.
- Find and report patterns across all 100 apps.
- Implement a real verification loop, not merely a second unverified model opinion.
- Report first-pass accuracy and improved accuracy after verification only when those metrics are actually measured against the verified/adjudicated dataset.
- Report mistakes and corrections honestly.
- Produce one self-explanatory, static HTML case study.
- Provide a README with reproducible setup and run instructions.
- Stay intentionally scoped to approximately 6–8 implementation hours: favor a CLI, JSON artifacts, caching, and static generation over a web application or database.

## Architecture

Use a batch pipeline with persisted intermediate artifacts:

```text
100-app manifest
    -> discovery and source collection
    -> first-pass structured extraction
    -> automatic validation and independent verification
    -> human exception review and adjudication
    -> final dataset and aggregate analysis
    -> static single-file HTML report
```

Recommended source layout:

```text
apps/                 Stable 100-app manifest and aliases
src/models/           Zod schemas and domain types
src/composio/         Current Composio SDK/catalog integration
src/research/         Source discovery, fetching, caching, extraction
src/verify/           Validation, independent pass, comparison, adjudication
src/analysis/         Metrics, pattern analysis, mistake analysis
src/report/           Static HTML rendering and inline assets
src/lib/              Caching, retries, rate limiting, provenance helpers
data/raw/             Cached raw sources; normally gitignored
data/runs/            Timestamped, immutable run artifacts
data/reviewed/        Human review inputs and adjudications
data/final/           Final JSON/CSV exports
report/               Generated `case-study.html`
test/                 Unit, integration, fixtures, and report tests
```

Preserve the distinction between:

- raw source material;
- first-pass extracted claims;
- verified/adjudicated claims; and
- aggregate analysis.

Never overwrite first-pass results with verified results. Preserve a correction log showing the old value, final value, reason, evidence, and reviewer/automated status.

## Coding conventions

- Keep the project a TypeScript CLI. Do not introduce a server, database, frontend framework, or deployment layer without a clear assignment need.
- Prefer small, single-purpose modules and explicit data flow over broad utility abstractions.
- Use immutable, timestamped run artifacts. A rerun with cached inputs must be inspectable and reproducible.
- Do not place API keys, source contents containing secrets, or user credentials in committed files.
- Keep raw-source cache paths and generated artifacts configurable through environment variables or a typed config module.
- Use bounded concurrency, retries with backoff, timeouts, and clear per-app error artifacts for all network work.
- Use stable app IDs and an explicit alias map; do not rely on fuzzy app-name matching without recording the match rationale.
- Every CLI command must be safe to rerun. Avoid destructive writes; create new run directories or require an explicit overwrite flag.
- Keep generated files deterministic when run with cached inputs and fixed model responses.

## TypeScript conventions

- Use strict TypeScript configuration. Do not use `any` or unchecked type assertions to bypass schema problems.
- Validate every external boundary with Zod: environment variables, JSON files, API responses, LLM output, CSV imports, and generated dataset records.
- Define domain types from Zod schemas where practical; keep controlled vocabularies as string unions/enums.
- Model missing or inconclusive evidence explicitly with `UNKNOWN`; do not use `null`, empty strings, or omitted properties to silently mean unknown.
- Prefer `async`/`await`, explicit return types for exported functions, and typed error/result objects for per-app recoverable failures.
- Avoid boolean-only fields when a status union conveys evidence quality or workflow state.
- Keep prompt versions, model identifiers, source retrieval times, and run IDs in provenance fields.

## Composio conventions

- Use the current `@composio/core` TypeScript SDK and current v3/v3.1 Composio API surfaces only.
- Do not copy examples from legacy/v1 SDK documentation or use deprecated fields such as `entity_id`; use current `userId`/`user_id` conventions as required by the current SDK/API.
- Use Composio primarily as a catalog and integration-coverage signal for this assignment: toolkit presence, current metadata, supported tools, and tool breadth.
- Do not equate Composio catalog presence with an application's public API, self-serve credentials, broad API coverage, or official MCP support. Each is a separate claim requiring its own evidence.
- If executing a Composio tool is necessary, explicitly resolve or pin the toolkit version and use a scoped test user. Never use a live connected account unnecessarily.
- Do not send raw third-party credentials through prompts, logs, report artifacts, or source caches.
- Prefer a direct API/toolkit route when it demonstrates a concrete fact. Do not call a Composio tool solely to make the implementation appear agentic.

## Research quality rules

1. Never invent evidence.
2. Never claim an authentication method without supporting evidence.
3. Never infer self-serve access from the existence of an API.
4. Never claim MCP support without evidence.
5. Prefer official documentation.
6. If evidence is insufficient, return `UNKNOWN`.
7. Keep raw evidence separate from normalized findings.
8. Preserve source URLs.
9. Never fabricate accuracy numbers.
10. Make verification reproducible.

Additionally:

- Treat each requested field as an individual claim. A source supporting REST availability does not automatically support OAuth availability, pricing, API breadth, or agent-toolkit feasibility.
- Record short supporting excerpts and retrieval timestamps alongside each evidence URL. Do not store unsupported paraphrases as evidence.
- Cite the most direct primary source available: API documentation for API shape, auth documentation for auth, pricing/signup/developer-program pages for credential access, and a maintainer repository or official documentation for MCP status.
- Use secondary sources only when primary documentation is unavailable, clearly label them as secondary, and lower confidence appropriately.
- Never infer absence from a failed search. Use `UNKNOWN` or `none_found` only according to the status definitions below.
- Keep source discovery and extraction prompts narrowly scoped to facts that can be evidenced. The model must be allowed to return `UNKNOWN` for every claim.
- Store source content hashes or equivalent provenance to make later verification possible even if a page changes.

## Evidence requirements

Every final non-`UNKNOWN` finding must have at least one evidence object containing:

- original, canonical source URL;
- source publisher/domain;
- source type (`official_docs`, `official_developer_portal`, `official_pricing`, `official_github`, `composio_catalog`, or `secondary`);
- retrieval timestamp;
- short relevant excerpt or precise structured reference; and
- the claim paths it supports.

Rules:

- Preserve exact source URLs in raw and normalized artifacts. Canonicalize only in an additional field; never discard the observed URL.
- Do not reuse a citation for unrelated claims unless its content directly supports each claim path.
- Evidence must support the normalized conclusion, not merely mention the product.
- A source URL that is inaccessible, redirects to an unrelated page, or no longer supports the claim fails verification.
- A Composio catalog record may support Composio coverage/tool count, but not independent claims about the vendor's external developer program.
- Any assertion that credentials are free, paid, trial, admin-approved, partner-gated, contact-sales, self-serve, or gated requires direct access/pricing/signup/developer documentation evidence.

## Official and third-party source rules

Source priority:

1. The application's official API/developer documentation.
2. The application's official authentication, pricing, signup, legal, support, or developer-program pages.
3. The application's official GitHub organization or maintainer-owned repository.
4. Composio's official catalog/docs, for Composio-specific facts only.
5. Reputable third-party sources, explicitly marked `secondary`.

For MCP:

- `official` means the application vendor or clearly authorized maintainer publishes or documents the MCP server.
- `community` means a credible third party publishes one, with the author and URL recorded.
- `none_found` means the defined search protocol was completed and found no credible official or community server. It does not mean MCP is impossible or definitively absent.
- `UNKNOWN` means the MCP search could not be completed or evidence quality is inadequate.

Never describe a community MCP server as vendor-supported. Never treat an MCP server listed by an aggregator as official without maintainer evidence.

## Verification requirements

Verification must be a persisted, repeatable process:

- Run structural validation for every record: schema validity, required fields, valid URLs, supported claim paths, controlled vocabulary, and provenance presence.
- Run evidence validation: source reachability where possible, domain relevance, excerpt/claim consistency, and evidence coverage for every final non-`UNKNOWN` claim.
- Perform a second, independent evidence pass for consequential claims, using distinct sources when possible and preferring primary sources.
- Compare first-pass and verification findings field-by-field. Auto-accept only corroborated findings that pass validation.
- Route conflicts, insufficient evidence, unknown source ownership, and high-impact feasibility decisions into a human-review queue.
- Preserve human adjudications with rationale and supporting URLs; do not silently edit values.
- Publish verification status per app and per claim where feasible: `unverified`, `auto_verified`, `needs_human_review`, or `human_verified`.
- Record the exact run ID, input data version, source retrieval timestamps/hashes, prompt version, model identifier, and verification rules version.

Accuracy calculations:

- First-pass accuracy is the percentage of scorable first-pass fields matching the final verified/adjudicated fields.
- Post-verification accuracy must be defined from an actual final validation/adjudication sample; never call agreement between two models “accuracy.”
- Exclude fields that are not scorable by the stated rule and report denominator, exclusions, and methodology.
- If no credible ground truth/adjudication set exists, report coverage and agreement metrics instead of accuracy.
- Report corrections and mistakes by field type and never hide unfavorable results.

## Anti-hallucination rules

- A model response is a hypothesis until its evidence is validated.
- Never allow a model to create URLs, source excerpts, official ownership claims, pricing claims, API methods, tool counts, or accuracy metrics without retrieved source material.
- If an LLM output cites a URL that was not fetched/discovered in the run, reject the citation and mark the claim `UNKNOWN` or `needs_human_review`.
- Do not turn absence of a result, a robots restriction, a network failure, or a blocked page into a negative product claim.
- Do not infer API breadth solely from marketing language; ground it in documented resources/endpoints/capabilities and record a rationale.
- Do not infer agent-toolkit feasibility solely from a product API or a Composio toolkit. The assessment requires a feasible auth route plus an executable API/tool surface. Record the primary blocker otherwise.
- Keep confidence calibrated to evidence quality, source recency, directness, and agreement—not model certainty.

## Rules for `UNKNOWN`

`UNKNOWN` is an explicit, valid research outcome and must be preserved through reporting and analysis.

- Use `UNKNOWN` whenever direct evidence is missing, conflicting without adjudication, inaccessible, stale, or too indirect.
- Use `UNKNOWN` for credential access when an API exists but available documentation does not establish whether developer credentials are self-serve or gated.
- Use `UNKNOWN` for authentication methods unless a source directly documents the method.
- Use `UNKNOWN` for MCP status when the defined search protocol was incomplete or ownership cannot be established.
- Use `none` only when reliable official documentation explicitly establishes no public API surface. Do not use `none` to mean “not found.”
- Use `none_found` only for completed MCP searches, with the search scope recorded.
- Never coerce `UNKNOWN` into a more favorable category for charts, summaries, or agent-toolkit feasibility. Show it separately.
- Low confidence does not replace `UNKNOWN`: use both when appropriate.

## Testing requirements

- Use Vitest and fixtures for all core pipeline behavior.
- Unit-test schemas, controlled-vocabulary normalization, evidence coverage, URL validation, source ranking, breadth classification, MCP classification, disagreement detection, correction logging, and accuracy denominators.
- Maintain representative fixtures for: a self-serve public API, an enterprise/admin-gated API, an app with no documented public API, an official MCP server, a community-only MCP server, and insufficient evidence.
- Integration-test Composio catalog ingestion behind an opt-in environment flag; default tests must use captured fixtures and never require credentials or network access.
- Provide a five-app end-to-end smoke run that exercises research, verification, analysis, and report generation.
- Test the rendered report for exactly 100 apps in a full fixture/final run, every required field, evidence-link rendering, absence of unresolved placeholders, and accuracy-metric denominator disclosure.
- Add deterministic rerun tests using cached sources and fixed model fixtures.
- CI must run formatting/lint checks, TypeScript typechecking, unit tests, and report validation.

## HTML case-study instructions

Generate `report/case-study.html` as one static, self-contained file:

- Inline CSS, JavaScript, charts, and data; do not depend on a CDN or runtime network requests.
- Include an executive summary, scope/date, methodology, Composio's exact role, reproducibility information, cross-app patterns, first-pass versus verified results, correction/mistake analysis, limitations, and human-review notes.
- Include a filterable table for all 100 apps with every assignment field and clickable evidence links.
- Include per-app details or expandable sections showing claim evidence, confidence, verification status, and corrections.
- Define all rubric labels: API breadth, confidence, credential-access classes, MCP statuses, and verification statuses.
- Clearly distinguish `UNKNOWN`, `none`, and `none_found` in the visual design and aggregate metrics.
- Make claims in narrative sections traceable to the final dataset and do not add unsupported editorial conclusions.
- Embed the final normalized dataset in the report, for example as JSON in a script element, so review remains possible offline.
- State the measurement methodology and denominator next to every accuracy figure.

## Expected commands

Implement the following `npm` scripts and keep this section synchronized with `package.json`:

```text
npm install
npm run apps:validate          # Validate the 100-app manifest
npm run research:discover      # Discover/cache candidate sources and Composio catalog facts
npm run research:first-pass    # Produce structured first-pass findings
npm run verify:auto            # Run schema, evidence, and consistency validation
npm run verify:independent     # Run independent verification/reconciliation
npm run review:export          # Export unresolved records for human review
npm run review:import          # Import recorded human adjudications
npm run analyze                # Compute patterns, corrections, and honest metrics
npm run report                 # Generate report/case-study.html
npm run pipeline               # Run the complete non-interactive pipeline
npm run typecheck
npm run lint
npm test
npm run test:integration       # Opt-in/live integration tests where configured
```

Document required environment variables in `.env.example` and README. At minimum, keep API keys optional for fixture-based tests; live research/Composio runs must fail clearly with a configuration error when required credentials are absent.
