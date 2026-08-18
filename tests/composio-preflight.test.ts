import type { ToolList } from "@composio/core";
import { describe, expect, it, vi } from "vitest";

import type { ComposioResearchClient } from "../src/config/composio.js";
import {
  SearchDiscoveryUnavailableError,
  SearchToolExecutionFailureError,
  inspectResearchCapabilities,
  preflightResearchCapabilities,
  requireSearchCapability,
} from "../src/research/composio-preflight.js";

function tool(
  slug: string,
  name: string,
  toolkitSlug: string,
  toolkitName: string,
  parameter: string,
  description = name,
): ToolList[number] {
  return {
    slug,
    name,
    description,
    toolkit: { slug: toolkitSlug, name: toolkitName },
    inputParameters: {
      type: "object",
      properties: { [parameter]: { type: "string" } },
    },
  };
}

const discoveredSearch = {
  results: [{ primary_tool_slugs: ["WEB_SEARCH_DOCUMENTATION"] }],
  tool_schemas: {
    WEB_SEARCH_DOCUMENTATION: {
      tool_slug: "WEB_SEARCH_DOCUMENTATION",
      toolkit: "web_search",
      description: "Search the public web for documentation.",
      input_schema: { type: "object", properties: { query: { type: "string" } } },
    },
  },
};

function createClient(
  tools: ToolList,
  execute: (slug: string, arguments_: Record<string, unknown> | undefined) => Promise<unknown>,
): ComposioResearchClient {
  return {
    sessions: {
      create: vi.fn().mockResolvedValue({
        sessionId: "session_preflight",
        execute: vi.fn(execute),
        search: vi.fn(),
      }),
    },
    tools: { getRawToolRouterSessionTools: vi.fn().mockResolvedValue(tools) },
  };
}

describe("Composio capability preflight", () => {
  it("supports a direct search tool already exposed by the session", async () => {
    const execute = vi.fn(async (slug: string) => {
      if (slug === "COMPOSIO_SEARCH_TOOLS") {
        return {
          data: {
            results: [{ primary_tool_slugs: ["CURRENT_WEB_LOOKUP"] }],
            tool_schemas: {
              CURRENT_WEB_LOOKUP: {
                tool_slug: "CURRENT_WEB_LOOKUP",
                toolkit: "web",
                description: "Search the web.",
                input_schema: { type: "object", properties: { query: { type: "string" } } },
              },
            },
          },
        };
      }
      if (slug === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        return { data: {} };
      }
      throw new Error(`Unexpected tool: ${slug}`);
    });
    const client = createClient(
      [
        tool("CURRENT_WEB_LOOKUP", "Web Lookup", "web", "Web", "query"),
        tool("COMPOSIO_SEARCH_TOOLS", "Search tools", "session", "Session", "queries"),
        tool("COMPOSIO_MULTI_EXECUTE_TOOL", "Multi execute", "session", "Session", "tools"),
      ],
      execute,
    );

    const { report } = await preflightResearchCapabilities(client, "fixture-user");

    expect(report.selectedSearchTool).toMatchObject({
      slug: "CURRENT_WEB_LOOKUP",
      executionMechanism: "multi_execute",
      discoveredVia: "COMPOSIO_SEARCH_TOOLS",
    });
    expect(report.searchDiscovery?.returnedToolSlug).toBe("CURRENT_WEB_LOOKUP");
    expect(report.searchCapability).toBe("READY");
  });

  it("recognizes a session exposing only COMPOSIO_SEARCH_TOOLS as search discovery", () => {
    const report = inspectResearchCapabilities([
      tool("COMPOSIO_SEARCH_TOOLS", "Search tools", "session", "Session", "queries"),
    ]);

    expect(report.selectedSearchTool).toBeUndefined();
    expect(report.availableMetaTools?.map((item) => item.slug)).toContain("COMPOSIO_SEARCH_TOOLS");
  });

  it("discovers a search tool dynamically and probes it through multi-execute", async () => {
    const execute = vi.fn(async (slug: string) => {
      if (slug === "COMPOSIO_SEARCH_TOOLS") {
        return { data: discoveredSearch };
      }
      if (slug === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        return { data: { results: [] } };
      }
      throw new Error(`Unexpected tool: ${slug}`);
    });
    const client = createClient(
      [
        tool("COMPOSIO_SEARCH_TOOLS", "Search tools", "session", "Session", "queries"),
        tool("COMPOSIO_MULTI_EXECUTE_TOOL", "Multi execute", "session", "Session", "tools"),
      ],
      execute,
    );

    const { report } = await preflightResearchCapabilities(client, "fixture-user");

    expect(report.selectedSearchTool).toMatchObject({
      slug: "WEB_SEARCH_DOCUMENTATION",
      toolkitSlug: "web_search",
      parameterName: "query",
      executionMechanism: "multi_execute",
      discoveredVia: "COMPOSIO_SEARCH_TOOLS",
      schemaLookupRequired: false,
    });
    expect(execute).toHaveBeenCalledWith("COMPOSIO_SEARCH_TOOLS", {
      queries: [{ use_case: "search the web for official API documentation for an application" }],
    });
    expect(execute).toHaveBeenCalledWith("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: "WEB_SEARCH_DOCUMENTATION", arguments: { query: "official API documentation" } }],
    });
    expect(report.searchCapability).toBe("READY");
  });

  it("looks up a discovered tool schema when Composio returns schemaRef", async () => {
    const execute = vi.fn(async (slug: string) => {
      if (slug === "COMPOSIO_SEARCH_TOOLS") {
        return {
          data: {
            results: [{ primary_tool_slugs: ["WEB_SEARCH_DOCUMENTATION"] }],
            tool_schemas: {
              WEB_SEARCH_DOCUMENTATION: {
                tool_slug: "WEB_SEARCH_DOCUMENTATION",
                toolkit: "web_search",
                description: "Search the public web.",
                schemaRef: {
                  tool: "COMPOSIO_GET_TOOL_SCHEMAS",
                  args: { tool_slugs: ["WEB_SEARCH_DOCUMENTATION"] },
                },
              },
            },
          },
        };
      }
      if (slug === "COMPOSIO_GET_TOOL_SCHEMAS") {
        return { data: discoveredSearch };
      }
      if (slug === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        return { data: {} };
      }
      throw new Error(`Unexpected tool: ${slug}`);
    });
    const client = createClient(
      [
        tool("COMPOSIO_SEARCH_TOOLS", "Search tools", "session", "Session", "queries"),
        tool("COMPOSIO_GET_TOOL_SCHEMAS", "Get schemas", "session", "Session", "tool_slugs"),
        tool("COMPOSIO_MULTI_EXECUTE_TOOL", "Multi execute", "session", "Session", "tools"),
      ],
      execute,
    );

    const { report } = await preflightResearchCapabilities(client, "fixture-user");

    expect(report.selectedSearchTool?.schemaLookupRequired).toBe(true);
    expect(execute).toHaveBeenCalledWith("COMPOSIO_GET_TOOL_SCHEMAS", {
      tool_slugs: ["WEB_SEARCH_DOCUMENTATION"],
    });
  });

  it("fails non-retryably when neither direct search nor search discovery is available", () => {
    const report = inspectResearchCapabilities([
      tool("FETCH_PAGE", "Fetch a page", "documents", "Documents", "url"),
    ]);

    expect(() => requireSearchCapability(report)).toThrow(SearchDiscoveryUnavailableError);
    expect(() => requireSearchCapability(report)).toThrow("SEARCH_DISCOVERY_UNAVAILABLE");
  });

  it("reports a distinct execution failure after successful discovery", async () => {
    const client = createClient(
      [
        tool("COMPOSIO_SEARCH_TOOLS", "Search tools", "session", "Session", "queries"),
        tool("COMPOSIO_MULTI_EXECUTE_TOOL", "Multi execute", "session", "Session", "tools"),
      ],
      async (slug) => {
        if (slug === "COMPOSIO_SEARCH_TOOLS") {
          return { data: discoveredSearch };
        }
        return { data: {}, error: "provider temporarily unavailable" };
      },
    );

    await expect(preflightResearchCapabilities(client, "fixture-user"))
      .rejects.toThrow(SearchToolExecutionFailureError);
    await expect(preflightResearchCapabilities(client, "fixture-user"))
      .rejects.toThrow("SEARCH_TOOL_EXECUTION_FAILURE");
  });
});
