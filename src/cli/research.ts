import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { ApiResearchAgent, type StructuredResearchResultGenerator } from "../agent/research-agent.js";
import { createComposioClient, loadComposioConfig } from "../config/composio.js";
import { loadConfig } from "../config/environment.js";
import { preflightResearchCapabilities, requireSearchCapability } from "../research/composio-preflight.js";
import { parseResearchCliOptions } from "./research-options.js";
import { BatchResearchRunner } from "../runner/batch-research-runner.js";

const options = parseResearchCliOptions(process.argv.slice(2));
const config = loadConfig();

const composioConfig = loadComposioConfig();
if (composioConfig === undefined) {
  throw new Error(
    "COMPOSIO_API_KEY is required for live research. Fixture-based BatchResearchRunner tests do not require it.",
  );
}

if (config.researchResultGeneratorModule === undefined) {
  throw new Error(
    "RESEARCH_RESULT_GENERATOR_MODULE is required. It must export a default or named resultGenerator "+
      "that implements StructuredResearchResultGenerator.",
  );
}
if (options.command === "resume" && config.researchRunId === undefined) {
  throw new Error("RESEARCH_RUN_ID is required for npm run research:resume.");
}

const client = createComposioClient(composioConfig);
const preflight = await preflightResearchCapabilities(client, "research-run-preflight");
const selectedSearchTool = requireSearchCapability(preflight.report);
console.info(
  JSON.stringify({
    researchPreflight: {
      selectedSearchTool,
      selectedFetchTool: preflight.report.selectedFetchTool ?? "NONE",
    },
  }),
);

const resultGenerator = await loadResultGenerator(config.researchResultGeneratorModule);
const agent = new ApiResearchAgent({
  client,
  resultGenerator,
});
const runner = new BatchResearchRunner({
  agent,
  concurrency: config.concurrency,
  maxRetries: config.researchMaxRetries,
  runsDirectory: `${config.dataDirectory}/runs`,
  ...(config.researchRunId === undefined ? {} : { runId: config.researchRunId }),
});
const summary =
  options.command === "single"
    ? await runner.runSingle(requireAppId(options.singleAppId))
    : options.selectors === undefined
      ? await runner.run()
      : await runner.runSelected(options.selectors);
console.info(JSON.stringify(summary, null, 2));

function requireAppId(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error("Usage: npm run research:single -- <app-id>");
  }
  return value;
}

async function loadResultGenerator(modulePath: string): Promise<StructuredResearchResultGenerator> {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), modulePath)).href;
  const loaded: unknown = await import(moduleUrl);
  const generatorSchema = z.object({
    generate: z.function().args(z.unknown()).returns(z.promise(z.unknown())),
  });
  const moduleSchema = z
    .object({
      resultGenerator: generatorSchema.optional(),
      default: generatorSchema.optional(),
    })
    .passthrough();
  const module = moduleSchema.parse(loaded);
  const generator = module.resultGenerator ?? module.default;
  if (generator === undefined) {
    throw new Error(
      "The result-generator module must export `resultGenerator` or default with an async generate() function.",
    );
  }
  return { generate: async (input) => generator.generate(input) };
}
