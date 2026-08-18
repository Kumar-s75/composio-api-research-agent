import type {
  ToolList,
  ToolRouterCreateSessionConfig,
  ToolRouterSessionSearchResponse,
} from "@composio/core";

import type {
  ComposioResearchClient,
  ComposioResearchSession,
} from "../config/composio.js";

/**
 * Toolkits are limited to public web-research capabilities. Application
 * integrations are intentionally not selected here; that belongs to later
 * research and buildability phases.
 */
export const researchToolkits = ["composio_search", "browser_tool"] as const;

export const researchSessionConfig = {
  toolkits: [...researchToolkits],
  manageConnections: false,
} satisfies ToolRouterCreateSessionConfig;

export const researchCapabilities = {
  web_search: {
    toolkit: "composio_search",
    toolSlugs: ["COMPOSIO_SEARCH_WEB", "COMPOSIO_SEARCH_DUCK_DUCK_GO"],
  },
  fetch_url_content: {
    toolkit: "composio_search",
    toolSlugs: ["COMPOSIO_SEARCH_FETCH_URL_CONTENT"],
  },
  discover_research_tools: {
    toolkit: "session",
    toolSlugs: [],
  },
  browser_interaction_when_available: {
    toolkit: "browser_tool",
    toolSlugs: ["BROWSER_TOOL_CREATE_TASK", "BROWSER_TOOL_GET_SESSION"],
  },
} as const;

export interface ResearchSessionOptions {
  userId: string;
}

/**
 * Creates a current Composio session scoped to the research user. This module
 * only exposes Composio capabilities; it does not decide queries, interpret
 * sources, or create research findings.
 */
export async function createResearchSession(
  client: ComposioResearchClient,
  options: ResearchSessionOptions,
): Promise<ComposioResearchSession> {
  const userId = options.userId.trim();
  if (userId.length === 0) {
    throw new Error("A non-empty research user ID is required.");
  }

  return client.sessions.create(userId, researchSessionConfig);
}

/** Returns the raw, session-scoped tool definitions without binding them to an LLM provider. */
export async function getResearchSessionTools(
  client: ComposioResearchClient,
  session: ComposioResearchSession,
): Promise<ToolList> {
  return client.tools.getRawToolRouterSessionTools(session.sessionId);
}

/** Discovers relevant tools through the session's current SDK-supported search surface. */
export async function discoverResearchTools(
  session: ComposioResearchSession,
  query: string,
): Promise<ToolRouterSessionSearchResponse> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    throw new Error("A non-empty tool-discovery query is required.");
  }

  return session.search({
    query: trimmedQuery,
    toolkits: [...researchToolkits],
  });
}
