import { z } from "zod";

export const unknownValueSchema = z.literal("UNKNOWN");

export const sourceTypeSchema = z.enum([
  "official_developer_documentation",
  "official_api_documentation",
  "official_pricing_or_developer_page",
  "official_github_repository",
  "official_mcp_documentation_or_repository",
  "reputable_third_party_documentation",
  "search_snippet",
]);

export const rawEvidenceSchema = z.object({
  observedUrl: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  publisher: z.string().min(1),
  sourceType: sourceTypeSchema,
  retrievedAt: z.string().datetime(),
  contentHash: z.string().min(1),
  excerpt: z.string().min(1),
});

export const researchRunSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
});

export type RawEvidence = z.infer<typeof rawEvidenceSchema>;
export type ResearchRun = z.infer<typeof researchRunSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;
