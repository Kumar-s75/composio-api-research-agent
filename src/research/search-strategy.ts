import { z } from "zod";

import { assignmentCategorySchema } from "../types/apps.js";

export const researchAppSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: assignmentCategorySchema,
  })
  .strict();

export const searchPurposeSchema = z.enum([
  "official_api_documentation",
  "developer_authentication",
  "oauth",
  "api_key",
  "developer_pricing",
  "mcp",
  "ambiguity_resolution",
]);

export interface SearchQuery {
  purpose: z.infer<typeof searchPurposeSchema>;
  query: string;
  preferOfficial: boolean;
}

export interface SearchStrategy {
  initial: SearchQuery[];
  fallback: SearchQuery[];
}

export type ResearchApp = z.infer<typeof researchAppSchema>;

/**
 * Produces a deterministic, app-specific research plan. The initial API-docs
 * query is deliberately first so official developer documentation is sought
 * before secondary material.
 */
export function createSearchStrategy(app: ResearchApp): SearchStrategy {
  const name = app.name;

  return {
    initial: [
      {
        purpose: "official_api_documentation",
        query: `${name} API documentation`,
        preferOfficial: true,
      },
      {
        purpose: "developer_authentication",
        query: `${name} developer authentication`,
        preferOfficial: true,
      },
      {
        purpose: "oauth",
        query: `${name} OAuth API`,
        preferOfficial: true,
      },
      {
        purpose: "api_key",
        query: `${name} API key`,
        preferOfficial: true,
      },
      {
        purpose: "developer_pricing",
        query: `${name} developer pricing`,
        preferOfficial: true,
      },
      {
        purpose: "mcp",
        query: `${name} MCP`,
        preferOfficial: true,
      },
    ],
    fallback: [
      {
        purpose: "ambiguity_resolution",
        query: `${name} official developer documentation API authentication pricing`,
        preferOfficial: true,
      },
      {
        purpose: "ambiguity_resolution",
        query: `${name} official API access requirements partner contact sales`,
        preferOfficial: true,
      },
      {
        purpose: "ambiguity_resolution",
        query: `${name} official MCP server`,
        preferOfficial: true,
      },
    ],
  };
}
