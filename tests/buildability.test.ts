import { describe, expect, it } from "vitest";

import { scoreBuildability } from "../src/scoring/buildability.js";
import type { NormalizedResearchResult } from "../src/types/research-result.js";

function research(overrides: Partial<NormalizedResearchResult> = {}): NormalizedResearchResult {
  return {
    app: { id: "example", name: "Example", category: "CRM and Sales", description: "Example app." },
    authentication: { methods: ["oauth2"], primary_method: "oauth2", notes: "OAuth is documented." },
    credential_access: {
      model: "self_serve",
      free: "yes",
      trial: "no",
      paid_plan: "no",
      admin_approval: "no",
      partner_required: "no",
      contact_sales: "no",
      notes: "Self-service credentials are available.",
    },
    api: {
      documented: "yes",
      types: ["REST"],
      rest: "yes",
      graphql: "no",
      other: "no",
      breadth: "broad",
      mcp: "official",
      mcp_evidence: [],
    },
    buildability: { verdict: "buildable", score: 5, blocker: "none", rationale: "Model supplied." },
    evidence: [],
    research_metadata: {
      researched_at: "2026-08-17T12:00:00.000Z",
      sources_consulted: [],
      confidence: "high",
    },
    verification: { status: "unverified", verifier_notes: "Not verified.", verified_at: "UNKNOWN" },
    ...overrides,
  };
}

describe("scoreBuildability", () => {
  it("scores fully self-serve documented APIs as EASY without using the model score", () => {
    const assessment = scoreBuildability(research());

    expect(assessment).toMatchObject({ score: 10, verdict: "EASY", blocker: "none" });
    expect(assessment.reasons).toContain("documented_public_api");
    expect(assessment.reasons).toContain("official_mcp_available");
  });

  it("blocks explicitly undocumented APIs", () => {
    const assessment = scoreBuildability(
      research({
        api: { ...research().api, documented: "no", types: ["none"], rest: "no", breadth: "none" },
      }),
    );

    expect(assessment).toEqual({
      score: 0,
      verdict: "BLOCKED",
      reasons: ["undocumented_or_private_api"],
      blocker: "no_public_api",
    });
  });

  it("applies credential-access penalties deterministically", () => {
    const base = research();
    const assessment = scoreBuildability({
      ...base,
      credential_access: {
        ...base.credential_access,
        model: "gated",
        free: "no",
        paid_plan: "yes",
        admin_approval: "yes",
        partner_required: "yes",
        contact_sales: "yes",
      },
      api: { ...base.api, breadth: "narrow", mcp: "none_found" },
    });

    expect(assessment).toMatchObject({ score: 0, verdict: "DIFFICULT", blocker: "credential_gated" });
    expect(assessment.reasons).toEqual(
      expect.arrayContaining(["paid_only_access", "admin_approval_required", "partner_requirement"]),
    );
  });

  it("returns UNKNOWN when the public API itself is unknown", () => {
    const base = research();
    expect(scoreBuildability({ ...base, api: { ...base.api, documented: "UNKNOWN" } })).toEqual({
      score: "UNKNOWN",
      verdict: "UNKNOWN",
      reasons: [],
      blocker: "insufficient_docs",
    });
  });
});
