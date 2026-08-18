import { createComposioClient, loadComposioConfig } from "../config/composio.js";
import { preflightResearchCapabilities } from "../research/composio-preflight.js";

const composioConfig = loadComposioConfig();
if (composioConfig === undefined) {
  throw new Error("COMPOSIO_API_KEY is required for the Composio preflight.");
}

const { report } = await preflightResearchCapabilities(
  createComposioClient(composioConfig),
  "research-capability-preflight",
);

console.info(
  JSON.stringify(
    {
      sessionCreated: true,
      availableToolkits: report.availableToolkits,
      availableToolSlugs: report.availableTools.map((tool) => tool.slug),
      availableMetaToolSlugs: (report.availableMetaTools ?? []).map((tool) => tool.slug),
      searchDiscovery: report.searchDiscovery ?? "NOT_ATTEMPTED",
      searchCapability: report.searchCapability ?? "NOT_READY",
      selectedSearchTool: report.selectedSearchTool === undefined
        ? "NONE"
        : {
          slug: report.selectedSearchTool.slug,
          toolkit: report.selectedSearchTool.toolkitSlug,
          executionMechanism: report.selectedSearchTool.executionMechanism,
          discoveredVia: report.selectedSearchTool.discoveredVia,
          schemaLookupRequired: report.selectedSearchTool.schemaLookupRequired,
        },
      selectedFetchTool: report.selectedFetchTool === undefined
        ? "NONE"
        : {
          slug: report.selectedFetchTool.slug,
          toolkit: report.selectedFetchTool.toolkitSlug,
        },
    },
    null,
    2,
  ),
);

if (report.searchCapability !== "READY" || report.selectedSearchTool === undefined) {
  process.exitCode = 1;
  console.error(
    "No runnable web-search capability is available through this Composio session. " +
      "Research will not start until dynamic search discovery succeeds.",
  );
}
