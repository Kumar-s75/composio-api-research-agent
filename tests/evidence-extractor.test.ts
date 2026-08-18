import { describe, expect, it } from "vitest";

import {
  assessEvidenceQuality,
  rankEvidenceSources,
  validateEvidenceCoverage,
  type CollectedSource,
} from "../src/research/evidence-extractor.js";
import type { Evidence, NormalizedResearchResult } from "../src/types/research-result.js";

const sourceUrl = "https://docs.example.test/api";
const retrievedAt = "2026-08-17T12:00:00.000Z";

const collectedSource: CollectedSource = {
  url: sourceUrl,
  page_title: "Example API documentation",
  summary: "Official API details.",
  origin: "fetch",
  retrieved_at: retrievedAt,
};

function createEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    claim: "The application has a public API.",
    normalized_field: "app.description",
    source_url: sourceUrl,
    source_type: "official_developer_documentation",
    page_title: "Example API documentation",
    evidence_summary: "The page documents the application's public API.",
    retrieved_at: retrievedAt,
    ...overrides,
  };
}

function createResult(evidence: Evidence[], description = "An example application."): NormalizedResearchResult {
  return {
    app: {
      id: "example-app",
      name: "Example App",
      category: "CRM and Sales",
      description,
    },
    authentication: {
      methods: ["UNKNOWN"],
      primary_method: "UNKNOWN",
      notes: "UNKNOWN",
    },
    credential_access: {
      model: "UNKNOWN",
      free: "UNKNOWN",
      trial: "UNKNOWN",
      paid_plan: "UNKNOWN",
      admin_approval: "UNKNOWN",
      partner_required: "UNKNOWN",
      contact_sales: "UNKNOWN",
      notes: "UNKNOWN",
    },
    api: {
      documented: "UNKNOWN",
      types: ["UNKNOWN"],
      rest: "UNKNOWN",
      graphql: "UNKNOWN",
      other: "UNKNOWN",
      breadth: "UNKNOWN",
      mcp: "UNKNOWN",
      mcp_evidence: [],
    },
    buildability: {
      verdict: "UNKNOWN",
      score: "UNKNOWN",
      blocker: "UNKNOWN",
      rationale: "UNKNOWN",
    },
    evidence,
    research_metadata: {
      researched_at: retrievedAt,
      sources_consulted: [sourceUrl],
      confidence: "high",
    },
    verification: {
      status: "unverified",
      verifier_notes: "Verification has not yet run.",
      verified_at: "UNKNOWN",
    },
  };
}

describe("evidence quality", () => {
  it("ranks official developer documentation ahead of other sources", () => {
    const ranked = rankEvidenceSources([
      createEvidence({ source_type: "search_snippet" }),
      createEvidence({ source_type: "reputable_third_party_documentation" }),
      createEvidence({ source_type: "official_developer_documentation" }),
    ]);

    expect(ranked.map((item) => item.source_type)).toEqual([
      "official_developer_documentation",
      "reputable_third_party_documentation",
      "search_snippet",
    ]);
  });

  it("marks third-party-only support as low confidence", () => {
    const result = createResult([
      createEvidence({ source_type: "reputable_third_party_documentation" }),
    ]);

    const assessment = assessEvidenceQuality(result);

    expect(assessment.weakly_supported_fields).toContain("app.description");
    expect(assessment.should_mark_low_confidence).toBe(true);
  });

  it("detects conflicting source claims for the same normalized field", () => {
    const result = createResult([
      createEvidence({ claim: "The application has a public API." }),
      createEvidence({ claim: "The application does not have a public API." }),
    ]);

    const assessment = assessEvidenceQuality(result);

    expect(assessment.conflicting_fields).toContain("app.description");
    expect(assessment.should_mark_low_confidence).toBe(true);
  });

  it("rejects a material claim without evidence for its normalized field", () => {
    const result = createResult([
      createEvidence({ normalized_field: "api.documented" }),
    ]);

    expect(() => validateEvidenceCoverage(result, [collectedSource])).toThrow(
      "Missing evidence for material claim: app.description",
    );
  });

  it("does not require evidence for an UNKNOWN claim", () => {
    const result = createResult(
      [createEvidence({ normalized_field: "api.documented" })],
      "UNKNOWN",
    );

    const assessment = assessEvidenceQuality(result);

    expect(assessment.missing_fields).not.toContain("app.description");
  });
});
