import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiResultGenerator,
  resultGenerator,
  type OpenAiResponseClient,
} from "../src/agent/openai-result-generator.js";
import { buildResearchSynthesisPrompt } from "../src/agent/prompts.js";
import type { NormalizedResearchResult } from "../src/types/research-result.js";

function validResult(): NormalizedResearchResult {
  return {
    app: { id: "github", name: "GitHub", category: "Developer, Infra and Data Platforms", description: "Code hosting." },
    authentication: { methods: ["UNKNOWN"], primary_method: "UNKNOWN", notes: "UNKNOWN" },
    credential_access: {
      model: "UNKNOWN", free: "UNKNOWN", trial: "UNKNOWN", paid_plan: "UNKNOWN", admin_approval: "UNKNOWN",
      partner_required: "UNKNOWN", contact_sales: "UNKNOWN", notes: "UNKNOWN",
    },
    api: {
      documented: "UNKNOWN", types: ["UNKNOWN"], rest: "UNKNOWN", graphql: "UNKNOWN", other: "UNKNOWN",
      breadth: "UNKNOWN", mcp: "UNKNOWN", mcp_evidence: [],
    },
    buildability: { verdict: "UNKNOWN", score: "UNKNOWN", blocker: "UNKNOWN", rationale: "UNKNOWN" },
    evidence: [{
      claim: "GitHub is a code hosting service.",
      normalized_field: "app.description",
      source_url: "https://docs.github.com",
      source_type: "official_api_documentation",
      page_title: "GitHub Docs",
      evidence_summary: "Fixture source.",
      retrieved_at: "2026-08-17T12:00:00.000Z",
    }],
    research_metadata: {
      researched_at: "2026-08-17T12:00:00.000Z",
      sources_consulted: ["https://docs.github.com"],
      confidence: "medium",
    },
    verification: { status: "unverified", verifier_notes: "Not verified.", verified_at: "UNKNOWN" },
  };
}

function clientWithOutput(output_text: string): OpenAiResponseClient {
  return {
    responses: { create: async () => ({ output_text }) },
  };
}

const app = { id: "github", name: "GitHub", category: "Developer, Infra and Data Platforms" as const };

const input = {
  prompt: buildResearchSynthesisPrompt(app, []),
  app,
  sources: [],
  promptVersion: "v1",
};

describe("OpenAI research result generator", () => {
  it("accepts a valid normalized result and sends the schema-derived contract", async () => {
    expect(typeof resultGenerator.generate).toBe("function");
    const create = vi.fn(async () => ({ output_text: JSON.stringify(validResult()) }));
    const generator = createOpenAiResultGenerator({
      client: { responses: { create } },
      model: "test-model",
    });

    await expect(generator.generate(input)).resolves.toEqual(validResult());
    expect(create).toHaveBeenCalledOnce();
    const request = create.mock.calls[0]?.[0];
    expect(request?.input).toContain('"credential_access"');
    expect(request?.input).toContain('"oauth2" | "api_key"');
    expect(request?.input).toContain('"normalized_field"');
    expect(request?.text.format).toMatchObject({
      type: "json_schema",
      name: "normalized_research_result",
      strict: true,
    });
  });

  it("accepts UNKNOWN where the normalized schema permits it", async () => {
    const generator = createOpenAiResultGenerator({
      client: clientWithOutput(JSON.stringify(validResult())),
      model: "test-model",
    });

    await expect(generator.generate(input)).resolves.toMatchObject({
      authentication: { methods: ["UNKNOWN"], primary_method: "UNKNOWN" },
      buildability: { score: "UNKNOWN" },
    });
  });

  it("rejects output with a missing required object", async () => {
    const { app: _app, ...missingApp } = validResult();
    const generator = createOpenAiResultGenerator({
      client: clientWithOutput(JSON.stringify(missingApp)),
      model: "test-model",
    });

    await expect(generator.generate(input)).rejects.toThrow(/app/);
  });

  it("rejects an invalid controlled enum value", async () => {
    const output = JSON.stringify(validResult()).replace('"primary_method":"UNKNOWN"', '"primary_method":"oauth"');
    const generator = createOpenAiResultGenerator({ client: clientWithOutput(output), model: "test-model" });

    await expect(generator.generate(input)).rejects.toThrow(/primary_method/);
  });

  it("rejects lowercase unknown rather than accepting an unsupported enum", async () => {
    const output = JSON.stringify(validResult()).replace('"admin_approval":"UNKNOWN"', '"admin_approval":"unknown"');
    const generator = createOpenAiResultGenerator({ client: clientWithOutput(output), model: "test-model" });

    await expect(generator.generate(input)).rejects.toThrow(/admin_approval/);
  });

  it("rejects placeholder fields rather than allowing them into the final output", async () => {
    const output = JSON.stringify(validResult()).replace(
      '"mcp_evidence":[]',
      '"mcp_evidence":[],"buildability_rationale_placeholder":"TODO"',
    );
    const generator = createOpenAiResultGenerator({ client: clientWithOutput(output), model: "test-model" });

    await expect(generator.generate(input)).rejects.toThrow(/buildability_rationale_placeholder/);
  });

  it("rejects malformed evidence", async () => {
    const output = JSON.stringify(validResult()).replace("https://docs.github.com", "not-a-url");
    const generator = createOpenAiResultGenerator({ client: clientWithOutput(output), model: "test-model" });

    await expect(generator.generate(input)).rejects.toThrow(/source_url/);
  });

  it("rejects the previous incorrect LLM shape", async () => {
    const generator = createOpenAiResultGenerator({
      client: clientWithOutput(JSON.stringify({
        application_id: "github",
        application_name: "GitHub",
        api_status: "documented",
        authentication_methods: ["oauth"],
      })),
      model: "test-model",
    });

    await expect(generator.generate(input)).rejects.toThrow(/app/);
  });
});
