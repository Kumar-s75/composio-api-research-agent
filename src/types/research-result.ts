import { z } from "zod";

import { assignmentCategorySchema } from "./apps.js";
import { sourceTypeSchema, unknownValueSchema } from "./research.js";

const unknownable = <T extends z.ZodTypeAny>(schema: T) => z.union([schema, unknownValueSchema]);

const availabilitySchema = z.enum(["yes", "no", "UNKNOWN"]);

export const authenticationMethodSchema = z.enum([
  "oauth2",
  "api_key",
  "basic_auth",
  "bearer_token",
  "service_account",
  "jwt",
  "custom",
  "none",
  "UNKNOWN",
]);

export const credentialAccessModelSchema = z.enum([
  "self_serve",
  "gated",
  "mixed",
  "not_applicable",
  "UNKNOWN",
]);

export const apiTypeSchema = z.enum(["REST", "GraphQL", "other", "none", "UNKNOWN"]);

export const apiBreadthSchema = z.enum([
  "none",
  "narrow",
  "moderate",
  "broad",
  "platform",
  "UNKNOWN",
]);

export const mcpStatusSchema = z.enum(["official", "community", "none_found", "UNKNOWN"]);

export const buildabilityVerdictSchema = z.enum([
  "buildable",
  "partially_buildable",
  "not_buildable",
  "UNKNOWN",
]);

export const buildabilityBlockerSchema = z.enum([
  "none",
  "no_public_api",
  "credential_gated",
  "no_supported_auth",
  "restricted_api",
  "insufficient_docs",
  "legal_or_policy_restriction",
  "UNKNOWN",
]);

export const confidenceSchema = z.enum([
  "very_low",
  "low",
  "medium",
  "high",
  "very_high",
  "UNKNOWN",
]);

export const verificationStatusSchema = z.enum([
  "unverified",
  "auto_verified",
  "needs_human_review",
  "human_verified",
  "UNKNOWN",
]);

export const evidenceClaimSchema = z.enum([
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
]);

export const evidenceSchema = z
  .object({
    claim: z.string().min(1),
    normalized_field: evidenceClaimSchema,
    source_url: z.string().url(),
    source_type: sourceTypeSchema,
    page_title: unknownable(z.string().min(1)),
    evidence_summary: z.string().min(1),
    retrieved_at: z.string().datetime({ offset: true }),
  })
  .strict();

const applicationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: unknownable(assignmentCategorySchema),
    description: unknownable(z.string().min(1)),
  })
  .strict();

const authenticationSchema = z
  .object({
    methods: z.array(authenticationMethodSchema).min(1),
    primary_method: authenticationMethodSchema,
    notes: z.string().min(1),
  })
  .strict();

const credentialAccessSchema = z
  .object({
    model: credentialAccessModelSchema,
    free: availabilitySchema,
    trial: availabilitySchema,
    paid_plan: availabilitySchema,
    admin_approval: availabilitySchema,
    partner_required: availabilitySchema,
    contact_sales: availabilitySchema,
    notes: z.string().min(1),
  })
  .strict();

const apiSchema = z
  .object({
    documented: availabilitySchema,
    types: z.array(apiTypeSchema).min(1),
    rest: availabilitySchema,
    graphql: availabilitySchema,
    other: availabilitySchema,
    breadth: apiBreadthSchema,
    mcp: mcpStatusSchema,
    mcp_evidence: z.array(evidenceSchema),
  })
  .strict()
  .superRefine((api, context) => {
    if ((api.mcp === "official" || api.mcp === "community") && api.mcp_evidence.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mcp_evidence"],
        message: "An official or community MCP claim requires MCP evidence.",
      });
    }
  });

const buildabilitySchema = z
  .object({
    verdict: buildabilityVerdictSchema,
    score: unknownable(z.number().int().min(0).max(5)),
    blocker: buildabilityBlockerSchema,
    rationale: z.string().min(1),
  })
  .strict();

const researchMetadataSchema = z
  .object({
    researched_at: z.string().datetime({ offset: true }),
    sources_consulted: z.array(z.string().url()),
    confidence: confidenceSchema,
  })
  .strict();

const verificationSchema = z
  .object({
    status: verificationStatusSchema,
    verifier_notes: z.string().min(1),
    verified_at: unknownable(z.string().datetime({ offset: true })),
  })
  .strict();

export const normalizedResearchResultSchema = z
  .object({
    app: applicationSchema,
    authentication: authenticationSchema,
    credential_access: credentialAccessSchema,
    api: apiSchema,
    buildability: buildabilitySchema,
    evidence: z.array(evidenceSchema).min(1),
    research_metadata: researchMetadataSchema,
    verification: verificationSchema,
  })
  .strict();

export type NormalizedResearchResult = z.infer<typeof normalizedResearchResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
