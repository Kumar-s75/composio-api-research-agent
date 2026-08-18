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
    composio_search: z.object({
      tool_slug: z.string().min(1),
      toolkit: z.string().min(1),
      discovered_via: z.enum(["direct_session_tool", "COMPOSIO_SEARCH_TOOLS"]),
      schema_lookup_required: z.boolean(),
    }).strict().optional(),
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

/**
 * Strict Structured Outputs requires every emitted object property to be
 * required. Composio search provenance is added by the pipeline after LLM
 * generation, so this schema omits only that optional canonical field.
 */

const llmEvidenceSchema = evidenceSchema.extend({
  source_url: z.string().min(1),
});

const llmApiSchema = z
  .object({
    documented: availabilitySchema,
    types: z.array(apiTypeSchema).min(1),
    rest: availabilitySchema,
    graphql: availabilitySchema,
    other: availabilitySchema,
    breadth: apiBreadthSchema,
    mcp: mcpStatusSchema,
    mcp_evidence: z.array(llmEvidenceSchema),
  })
  .strict();

const llmResearchMetadataSchema = researchMetadataSchema.omit({
  composio_search: true,
});

export const llmNormalizedResearchResultSchema = normalizedResearchResultSchema
  .omit({
    research_metadata: true,
    evidence: true,
    api: true,
  })
  .extend({
    api: llmApiSchema,
    evidence: z.array(llmEvidenceSchema).min(1),
    research_metadata: llmResearchMetadataSchema,
  })
  .strict();    
  
  

/**
 * Renders the canonical Zod schema as a concise, JSON-shaped contract for the
 * synthesis prompt. Keeping this adjacent to the validator prevents the LLM
 * contract from silently drifting from the enforcement boundary.
 */
export function renderNormalizedResearchResultPromptContract(): string {
  return [
    "All displayed keys are required unless marked optional. All objects are strict: do not add keys.",
    "Use the literal string UNKNOWN only where the contract below includes it; never use null.",
    "For values derived from sources, use the exact URL and retrieved_at timestamp from the collected-source list.",
    "Contract:",
    renderZodContract(normalizedResearchResultSchema, 0),
    "Additional validation: api.mcp of official or community requires at least one api.mcp_evidence item.",
  ].join("\n");
}

function renderZodContract(schema: z.ZodTypeAny, depth: number): string {
  if (schema instanceof z.ZodEffects) {
    return renderZodContract(schema.innerType(), depth);
  }
  if (schema instanceof z.ZodObject) {
    const indentation = "  ".repeat(depth);
    const childIndentation = "  ".repeat(depth + 1);
    const fields = Object.entries(schema.shape).map(([key, value]) => {
      const optional = value instanceof z.ZodOptional;
      const fieldSchema = optional ? value.unwrap() : value;
      return `${childIndentation}${JSON.stringify(key)}${optional ? " (optional)" : ""}: ${renderZodContract(fieldSchema, depth + 1)}`;
    });
    return `{\n${fields.join(",\n")}\n${indentation}}`;
  }
  if (schema instanceof z.ZodArray) {
    const minimum = schema._def.minLength?.value;
    const minimumDescription = minimum === undefined ? "" : `; at least ${minimum} item${minimum === 1 ? "" : "s"}`;
    return `array of ${renderZodContract(schema.element, depth)}${minimumDescription}`;
  }
  if (schema instanceof z.ZodEnum) {
    return schema.options.map((value: string) => JSON.stringify(value)).join(" | ");
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.map((option: z.ZodTypeAny) => renderZodContract(option, depth)).join(" | ");
  }
  if (schema instanceof z.ZodLiteral) {
    return JSON.stringify(schema.value);
  }
  if (schema instanceof z.ZodString) {
    return describeString(schema);
  }
  if (schema instanceof z.ZodNumber) {
    return describeNumber(schema);
  }
  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }
  return `unsupported Zod type (${schema._def.typeName})`;
}

function describeString(schema: z.ZodString): string {
  const constraints: string[] = [];
  for (const check of schema._def.checks) {
    if (check.kind === "min") {
      constraints.push(`min length ${check.value}`);
    } else if (check.kind === "url") {
      constraints.push("URL");
    } else if (check.kind === "datetime") {
      constraints.push("ISO 8601 datetime with offset");
    }
  }
  return constraints.length === 0 ? "string" : `string (${constraints.join(", ")})`;
}

function describeNumber(schema: z.ZodNumber): string {
  const constraints: string[] = [];
  for (const check of schema._def.checks) {
    if (check.kind === "int") {
      constraints.push("integer");
    } else if (check.kind === "min") {
      constraints.push(`minimum ${check.value}`);
    } else if (check.kind === "max") {
      constraints.push(`maximum ${check.value}`);
    }
  }
  return constraints.length === 0 ? "number" : `number (${constraints.join(", ")})`;
}

export type NormalizedResearchResult = z.infer<typeof normalizedResearchResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
