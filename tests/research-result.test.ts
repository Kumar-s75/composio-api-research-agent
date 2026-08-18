import { describe, expect, it } from "vitest";

import { normalizedResearchResultSchema } from "../src/types/research-result.js";

const validResult = {
  app: {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM and Sales",
    description: "A customer relationship management platform.",
  },
  authentication: {
    methods: ["oauth2", "api_key"],
    primary_method: "oauth2",
    notes: "OAuth is documented for this integration.",
  },
  credential_access: {
    model: "self_serve",
    free: "yes",
    trial: "yes",
    paid_plan: "no",
    admin_approval: "UNKNOWN",
    partner_required: "no",
    contact_sales: "no",
    notes: "Access classification is supported by the recorded sources.",
  },
  api: {
    documented: "yes",
    types: ["REST"],
    rest: "yes",
    graphql: "no",
    other: "no",
    breadth: "broad",
    mcp: "none_found",
    mcp_evidence: [],
  },
  buildability: {
    verdict: "buildable",
    score: 5,
    blocker: "none",
    rationale: "Documented authentication and API surface are available.",
  },
  evidence: [
    {
      claim: "Public API documentation is available.",
      normalized_field: "api.documented",
      source_url: "https://developer.example.com/api",
      source_type: "official_api_documentation",
      page_title: "API documentation",
      evidence_summary: "The API documentation describes supported requests.",
      retrieved_at: "2026-08-17T12:00:00.000Z",
    },
  ],
  research_metadata: {
    researched_at: "2026-08-17T12:00:00.000Z",
    sources_consulted: ["https://developer.example.com/api"],
    confidence: "high",
  },
  verification: {
    status: "unverified",
    verifier_notes: "Verification has not yet run.",
    verified_at: "UNKNOWN",
  },
} as const;

describe("normalizedResearchResultSchema", () => {
  it("accepts a valid normalized research result", () => {
    expect(normalizedResearchResultSchema.parse(validResult)).toMatchObject(validResult);
  });

  it("rejects missing required fields", () => {
    const missingDescription = {
      ...validResult,
      app: {
        id: validResult.app.id,
        name: validResult.app.name,
        category: validResult.app.category,
      },
    };

    expect(normalizedResearchResultSchema.safeParse(missingDescription).success).toBe(false);
  });

  it("rejects values outside controlled enums", () => {
    const invalidAuthenticationMethod = {
      ...validResult,
      authentication: {
        ...validResult.authentication,
        methods: ["saml"],
      },
    };

    expect(normalizedResearchResultSchema.safeParse(invalidAuthenticationMethod).success).toBe(false);
  });

  it("accepts explicit UNKNOWN values", () => {
    const unknownResult = {
      ...validResult,
      app: {
        ...validResult.app,
        category: "UNKNOWN",
        description: "UNKNOWN",
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
      research_metadata: {
        ...validResult.research_metadata,
        confidence: "UNKNOWN",
      },
      verification: {
        status: "UNKNOWN",
        verifier_notes: "UNKNOWN",
        verified_at: "UNKNOWN",
      },
    };

    expect(normalizedResearchResultSchema.safeParse(unknownResult).success).toBe(true);
  });

  it("rejects malformed evidence URLs", () => {
    const malformedEvidenceUrl = {
      ...validResult,
      evidence: [
        {
          ...validResult.evidence[0],
          source_url: "not-a-url",
        },
      ],
    };

    expect(normalizedResearchResultSchema.safeParse(malformedEvidenceUrl).success).toBe(false);
  });
});
