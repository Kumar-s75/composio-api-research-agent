import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { BatchResearchRunner, type RunnableResearchAgent } from "../src/runner/batch-research-runner.js";
import type { AppInput } from "../src/types/apps.js";
import type { NormalizedResearchResult } from "../src/types/research-result.js";
import { NonRetryableError } from "../src/utils/non-retryable-error.js";

const apps: AppInput[] = [
  { number: 1, category: "CRM and Sales", name: "Alpha App", websiteHint: "alpha.test" },
  { number: 2, category: "CRM and Sales", name: "Beta App", websiteHint: "beta.test" },
];

function result(id: string, name: string): NormalizedResearchResult {
  return {
    app: { id, name, category: "CRM and Sales", description: "A test app." },
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
      claim: "The supplied app description is a test fixture.",
      normalized_field: "app.description",
      source_url: "https://example.test/docs",
      source_type: "official_api_documentation",
      page_title: "Example documentation",
      evidence_summary: "Test evidence.",
      retrieved_at: "2026-08-17T12:00:00.000Z",
    }],
    research_metadata: {
      researched_at: "2026-08-17T12:00:00.000Z", sources_consulted: ["https://example.test/docs"], confidence: "high",
    },
    verification: { status: "unverified", verifier_notes: "Not verified.", verified_at: "UNKNOWN" },
  };
}

describe("BatchResearchRunner", () => {
  it("retries failures, persists raw and normalized artifacts, and resumes completed apps", async () => {
    const directory = await mkdtemp(join(tmpdir(), "composio-batch-"));
    let alphaAttempts = 0;
    const agent: RunnableResearchAgent = {
      researchWithArtifact: vi.fn(async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("id" in input) || !("name" in input)) {
          throw new Error("Invalid app input.");
        }
        const id = String(input.id);
        const name = String(input.name);
        if (id === "alpha-app" && alphaAttempts++ === 0) {
          throw new Error("Temporary source failure");
        }
        return {
          rawResearch: { model_response: id },
          collectedSources: [],
          normalizedResearch: result(id, name),
          deterministicBuildability: { score: "UNKNOWN", verdict: "UNKNOWN", reasons: [], blocker: "insufficient_docs" },
          capabilityReport: {
            availableToolkits: [], availableTools: [], selectedSearchTool: undefined, selectedFetchTool: undefined,
          },
        };
      }),
    };
    const options = {
      agent,
      concurrency: 2,
      maxRetries: 1,
      runsDirectory: directory,
      runId: "run-fixture",
      loadApps: async () => apps,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    };

    const first = await new BatchResearchRunner(options).run();

    expect(first).toMatchObject({ total: 2, successful: 2, failed: 0, retried: 1, averageConfidence: 4 });
    await expect(readFile(join(directory, "run-fixture", "raw", "alpha-app.json"), "utf8")).resolves.toContain(
      "model_response",
    );
    await expect(readFile(join(directory, "run-fixture", "normalized", "beta-app.json"), "utf8")).resolves.toContain(
      "Beta App",
    );
    await expect(readFile(join(directory, "run-fixture", "errors", "alpha-app.json"), "utf8")).resolves.toContain(
      "Temporary source failure",
    );

    const resumed = await new BatchResearchRunner(options).run();
    expect(resumed).toMatchObject({ total: 2, successful: 2, failed: 0, retried: 0 });
    expect(agent.researchWithArtifact).toHaveBeenCalledTimes(3);
  });

  it("runs a validated explicit selection and fails before research for unknown names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "composio-selection-"));
    const agent: RunnableResearchAgent = {
      researchWithArtifact: vi.fn(async (input: unknown) => {
        if (typeof input !== "object" || input === null || !("id" in input) || !("name" in input)) {
          throw new Error("Invalid app input.");
        }
        const id = String(input.id);
        const name = String(input.name);
        return {
          rawResearch: { model_response: id },
          collectedSources: [],
          normalizedResearch: result(id, name),
          deterministicBuildability: { score: "UNKNOWN", verdict: "UNKNOWN", reasons: [], blocker: "insufficient_docs" },
          capabilityReport: {
            availableToolkits: [], availableTools: [], selectedSearchTool: undefined, selectedFetchTool: undefined,
          },
        };
      }),
    };
    const runner = new BatchResearchRunner({
      agent,
      concurrency: 1,
      runsDirectory: directory,
      runId: "selected-fixture",
      loadApps: async () => apps,
    });

    await expect(runner.runSelected(["Beta App", "alpha-app", "ALPHA APP"])).resolves.toMatchObject({
      total: 2,
      successful: 2,
    });
    expect(agent.researchWithArtifact).toHaveBeenCalledTimes(2);

    await expect(runner.runSelected(["does-not-exist"])).rejects.toThrow(
      "Unknown app selector(s): does-not-exist.",
    );
    expect(agent.researchWithArtifact).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable capability failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "composio-non-retryable-"));
    const agent: RunnableResearchAgent = {
      researchWithArtifact: vi.fn(async () => {
        throw new NonRetryableError("Required web-search capability is unavailable.");
      }),
    };
    const summary = await new BatchResearchRunner({
      agent,
      concurrency: 1,
      maxRetries: 2,
      runsDirectory: directory,
      runId: "capability-fixture",
      loadApps: async () => [apps[0]!],
    }).run();

    expect(summary).toMatchObject({ total: 1, failed: 1, retried: 0 });
    expect(agent.researchWithArtifact).toHaveBeenCalledOnce();
  });
});
