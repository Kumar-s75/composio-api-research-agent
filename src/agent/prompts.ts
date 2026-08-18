import type { CollectedSource } from "../research/evidence-extractor.js";
import type { ResearchApp } from "../research/search-strategy.js";
import { renderNormalizedResearchResultPromptContract } from "../types/research-result.js";

export const researchPromptVersion = "v2";

export function buildResearchSynthesisPrompt(
  app: ResearchApp,
  sources: readonly CollectedSource[],
): string {
  return `You are producing an evidence-backed API research record for one application.

Application:
- id: ${app.id}
- name: ${app.name}
- category: ${app.category}

Return only a JSON object matching this exact contract. Do not add markdown or commentary.

${renderNormalizedResearchResultPromptContract()}

Research rules:
- Use only the collected sources below. Never invent a URL, title, quote, API capability, pricing/access condition, or MCP claim.
- Prefer source types in this order: official_developer_documentation, official_api_documentation, official_pricing_or_developer_page, official_github_repository, official_mcp_documentation_or_repository, reputable_third_party_documentation, then search_snippet. Use an official type only when the retrieved source establishes vendor ownership.
- Every known material claim must have an evidence item with a clear human-readable claim, a normalized_field matching the relevant field, the exact source_url, page_title when known, evidence_summary, and the exact retrieved_at timestamp from the collected source list.
- If the sources cannot establish a fact, use the exact value UNKNOWN. Do not infer self-serve access from API availability, do not infer authentication from a product name, and do not infer MCP support.
- Keep controlled enum values exactly as required by the schema.
- For MCP, official/community requires MCP evidence. none_found is permitted only if the supplied sources establish a completed search result; otherwise use UNKNOWN.
- Buildability requires both a feasible authentication route and an executable public API/tool surface. If that cannot be established, use UNKNOWN or a supported blocker enum.

Collected sources:
${formatSources(sources)}`;
}

function formatSources(sources: readonly CollectedSource[]): string {
  if (sources.length === 0) {
    return "No usable sources were collected.";
  }

  return sources
    .map(
      (source, index) =>
        `${index + 1}. URL: ${source.url}\n   Title: ${source.page_title}\n   Retrieved at: ${source.retrieved_at}\n   Summary: ${source.summary}`,
    )
    .join("\n");
}
