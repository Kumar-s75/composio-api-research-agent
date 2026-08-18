import { describe, expect, it, vi } from "vitest";

import type { ComposioResearchClient } from "../src/config/composio.js";
import { ApiResearchAgent, type StructuredResearchResultGenerator } from "../src/agent/research-agent.js";
import type { Evidence, NormalizedResearchResult } from "../src/types/research-result.js";

const collectedUrl = "https://docs.example.test/api";

const materialClaims: Evidence["normalized_field"][] = [
  "app.description",
  "authentication.methods",
  "authentication.primary_method",
  "authentication.notes",
  "credential_access.model",
  "credential_access.free",
  "credential_access.trial",
  "credential_access.paid_plan",
  "credential_access.admin_approval",
  "credential_access.partner_required",
  "credential_access.contact_sales",
  "credential_access.notes",
  "api.documented",
  "api.types",
  "api.rest",
  "api.graphql",
  "api.other",
  "api.breadth",
  "api.mcp",
  "buildability.verdict",
  "buildability.score",
  "buildability.blocker",
  "buildability.rationale",
];

function createMockClient(): ComposioResearchClient {
  const session = {
    sessionId: "session_research_example",
    execute: vi.fn(async (toolSlug: string) => {
      if (toolSlug === "COMPOSIO_SEARCH_TOOLS") {
        return {
          data: {
            results: [{ primary_tool_slugs: ["CURRENT_WEB_LOOKUP"] }],
            tool_schemas: {
              CURRENT_WEB_LOOKUP: {
                tool_slug: "CURRENT_WEB_LOOKUP",
                toolkit: "composio_search",
                description: "Search the public web.",
                input_schema: { type: "object", properties: { query: { type: "string" } } },
              },
            },
          },
        };
      }

      if (toolSlug === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        return {
          data: {
            results: [
              {
                url: collectedUrl,
                title: "Example API documentation",
                snippet: "Official API and authentication documentation.",
              },
            ],
          },
        };
      }

      if (toolSlug === "COMPOSIO_SEARCH_FETCH_URL_CONTENT") {
        return {
          url: collectedUrl,
          title: "Example API documentation",
          content: "The API supports OAuth and API keys.",
        };
      }

      return {};
    }),
    search: vi.fn().mockResolvedValue({ tools: [] }),
  };

  return {
    sessions: {
      create: vi.fn().mockResolvedValue(session),
    },
    tools: {
      getRawToolRouterSessionTools: vi.fn().mockResolvedValue([
        {
          slug: "COMPOSIO_SEARCH_TOOLS",
          name: "Search tools",
          toolkit: { slug: "session", name: "Session" },
          inputParameters: { type: "object", properties: { queries: { type: "array" } } },
        },
        {
          slug: "COMPOSIO_MULTI_EXECUTE_TOOL",
          name: "Multi execute",
          toolkit: { slug: "session", name: "Session" },
          inputParameters: { type: "object", properties: { tools: { type: "array" } } },
        },
        {
          slug: "COMPOSIO_SEARCH_FETCH_URL_CONTENT",
          name: "Fetch URL Content",
          toolkit: { slug: "composio_search", name: "Composio Search" },
          inputParameters: { type: "object", properties: { url: { type: "string" } } },
        },
      ]),
    },
  };
}

function createValidResult(
  evidenceUrl = collectedUrl,
  retrievedAt = "2026-08-17T12:00:00.000Z",
): NormalizedResearchResult {
  return {
    app: {
      id: "example-app",
      name: "Example App",
      category: "CRM and Sales",
      description: "An example customer relationship platform.",
    },
    authentication: {
      methods: ["oauth2", "api_key"],
      primary_method: "oauth2",
      notes: "Documented in the supplied source.",
    },
    credential_access: {
      model: "self_serve",
      free: "yes",
      trial: "no",
      paid_plan: "no",
      admin_approval: "no",
      partner_required: "no",
      contact_sales: "no",
      notes: "Documented in the supplied source.",
    },
    api: {
      documented: "yes",
      types: ["REST"],
      rest: "yes",
      graphql: "no",
      other: "no",
      breadth: "moderate",
      mcp: "none_found",
      mcp_evidence: [],
    },
    buildability: {
      verdict: "buildable",
      score: 4,
      blocker: "none",
      rationale: "A documented API and authentication route are available.",
    },
    evidence: materialClaims.map((claim) => ({
      claim: `${claim} is supported by the collected source.`,
      normalized_field: claim,
      source_url: evidenceUrl,
      source_type: "official_api_documentation",
      page_title: "Example API documentation",
      evidence_summary: "This source supports the recorded claim.",
      retrieved_at: retrievedAt,
    })),
    research_metadata: {
      researched_at: "2026-08-17T12:00:00.000Z",
      sources_consulted: [evidenceUrl],
      confidence: "high",
    },
    verification: {
      status: "unverified",
      verifier_notes: "Verification has not yet run.",
      verified_at: "UNKNOWN",
    },
  };
}

describe("ApiResearchAgent", () => {
  it("returns a schema-valid mocked result supported by collected evidence", async () => {
    const resultGenerator: StructuredResearchResultGenerator = {
      generate: vi.fn(async ({ sources }) => createValidResult(collectedUrl, sources[0]?.retrieved_at)),
    };
    const agent = new ApiResearchAgent({
      client: createMockClient(),
      resultGenerator,
      maxAttempts: 1,
    });

    const result = await agent.research({
      id: "example-app",
      name: "Example App",
      category: "CRM and Sales",
    });

    expect(result.app.name).toBe("Example App");
    expect(resultGenerator.generate).toHaveBeenCalledOnce();
  });

  it("does not allow a mocked research result with only uncollected evidence to reach final validation", async () => {
    const resultGenerator: StructuredResearchResultGenerator = {
      generate: vi.fn(async ({ sources }) =>
        createValidResult("https://invented.example.test/api", sources[0]?.retrieved_at),
      ),
    };
    const agent = new ApiResearchAgent({
      client: createMockClient(),
      resultGenerator,
      maxAttempts: 1,
    });

    await expect(
      agent.research({
        id: "example-app",
        name: "Example App",
        category: "CRM and Sales",
      }),
    ).rejects.toThrow(/evidence/);
  });
});
