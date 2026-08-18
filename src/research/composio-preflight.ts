import type { ToolList } from "@composio/core";
import { z } from "zod";

import type { ComposioResearchClient, ComposioResearchSession } from "../config/composio.js";
import { NonRetryableError } from "../utils/non-retryable-error.js";
import { createResearchSession, getResearchSessionTools } from "./composio-tools.js";

const searchDiscoveryToolSlug = "COMPOSIO_SEARCH_TOOLS";
const schemaLookupToolSlug = "COMPOSIO_GET_TOOL_SCHEMAS";
const multiExecuteToolSlug = "COMPOSIO_MULTI_EXECUTE_TOOL";
const discoveryQuery = "search the web for official API documentation for an application";
const executionProbeQuery = "official API documentation";

const rawSchemaRefSchema = z.object({
  args: z.object({
    toolSlugs: z.array(z.string()).optional(),
    tool_slugs: z.array(z.string()).optional(),
  }).passthrough(),
  tool: z.literal(schemaLookupToolSlug),
}).passthrough();

const rawDiscoveredToolSchema = z.object({
  toolSlug: z.string().optional(),
  tool_slug: z.string().optional(),
  toolkit: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  schemaRef: rawSchemaRefSchema.optional(),
}).passthrough();

const rawDiscoveryResultSchema = z.object({
  primaryToolSlugs: z.array(z.string()).optional(),
  primary_tool_slugs: z.array(z.string()).optional(),
}).passthrough();

const rawDiscoveryResponseSchema = z.object({
  results: z.array(rawDiscoveryResultSchema).optional(),
  toolSchemas: z.record(z.string(), rawDiscoveredToolSchema).optional(),
  tool_schemas: z.record(z.string(), rawDiscoveredToolSchema).optional(),
}).passthrough();

export type SearchExecutionMechanism = "direct" | "multi_execute";

export interface ResearchToolDescriptor {
  slug: string;
  name: string;
  description: string;
  toolkitSlug: string;
  toolkitName: string;
  inputParameters: string[];
}

export interface SelectedResearchTool {
  slug: string;
  name: string;
  toolkitSlug: string;
  toolkitName: string;
  parameterName: string;
  executionMechanism: SearchExecutionMechanism;
  discoveredVia: "direct_session_tool" | "COMPOSIO_SEARCH_TOOLS";
  schemaLookupRequired: boolean;
}

export interface SearchDiscoveryMetadata {
  query: string;
  discoveryToolAvailable: boolean;
  discoverySucceeded: boolean;
  executionProbeSucceeded: boolean;
  returnedToolSlug?: string;
  returnedToolkit?: string;
  schemaLookupRequired?: boolean;
}

export interface ResearchCapabilityReport {
  availableToolkits: Array<{ slug: string; name: string }>;
  availableTools: ResearchToolDescriptor[];
  availableMetaTools?: ResearchToolDescriptor[];
  selectedSearchTool: SelectedResearchTool | undefined;
  selectedFetchTool: SelectedResearchTool | undefined;
  searchDiscovery?: SearchDiscoveryMetadata;
  searchCapability?: "READY";
}

export interface ResearchPreflight {
  session: ComposioResearchSession;
  report: ResearchCapabilityReport;
}

/**
 * Creates a Composio research session, enumerates its helper tools, and uses
 * COMPOSIO_SEARCH_TOOLS to discover a real web-search tool at runtime. The
 * generic probe executes no application-specific research; it only confirms
 * that the discovered route is runnable.
 */
export async function preflightResearchCapabilities(
  client: ComposioResearchClient,
  userId: string,
): Promise<ResearchPreflight> {
  const session = await createResearchSession(client, { userId });
  const tools = await getResearchSessionTools(client, session);
  const inspected = inspectResearchCapabilities(tools);
  const discoveryTool = inspected.availableMetaTools?.find((tool) => tool.slug === searchDiscoveryToolSlug);

  if (discoveryTool === undefined) {
    throw new SearchDiscoveryUnavailableError(
      "COMPOSIO_SEARCH_TOOLS is not exposed by this Composio session.",
      inspected,
    );
  }

  const discoveredTool = await discoverSearchTool(session, discoveryTool, inspected);
  const selectedSearchTool = await resolveDiscoveredSearchTool(session, discoveredTool, inspected);
  await executeSearchTool(session, selectedSearchTool, executionProbeQuery);

  return {
    session,
    report: {
      ...inspected,
      selectedSearchTool,
      searchDiscovery: {
        query: discoveryQuery,
        discoveryToolAvailable: true,
        discoverySucceeded: true,
        executionProbeSucceeded: true,
        returnedToolSlug: selectedSearchTool.slug,
        returnedToolkit: selectedSearchTool.toolkitSlug,
        schemaLookupRequired: selectedSearchTool.schemaLookupRequired,
      },
      searchCapability: "READY",
    },
  };
}

/** Pure capability inspection used by the live preflight command and tests. */
export function inspectResearchCapabilities(tools: ToolList): ResearchCapabilityReport {
  const availableTools = tools.map(describeTool).sort(compareDescriptors);
  const directSearch = selectTool(availableTools, "search");
  const directFetch = selectTool(availableTools, "fetch");

  return {
    availableToolkits: uniqueToolkits(availableTools),
    availableTools,
    availableMetaTools: availableTools.filter(isMetaTool),
    selectedSearchTool: directSearch === undefined ? undefined : toDirectSelection(directSearch),
    selectedFetchTool: directFetch === undefined ? undefined : toDirectSelection(directFetch),
  };
}

/** Throws a non-retryable error before app processing when a search route is unavailable. */
export function requireSearchCapability(report: ResearchCapabilityReport): SelectedResearchTool {
  if (report.selectedSearchTool !== undefined) {
    return report.selectedSearchTool;
  }

  const available = report.availableTools.length === 0
    ? "no tools were exposed"
    : report.availableTools.map((tool) => `${tool.toolkitSlug}/${tool.slug}`).join(", ");
  throw new SearchDiscoveryUnavailableError(
    `Required web-search capability is unavailable in this Composio session; ${available}.`,
    report,
  );
}

/** Executes a selected search through the mechanism Composio prescribed for it. */
export async function executeSearchTool(
  session: ComposioResearchSession,
  tool: SelectedResearchTool,
  query: string,
): Promise<unknown> {
  const arguments_ = { [tool.parameterName]: query };
  try {
    const response = tool.executionMechanism === "multi_execute"
      ? await session.execute(multiExecuteToolSlug, {
        tools: [{ tool_slug: tool.slug, arguments: arguments_ }],
      })
      : await session.execute(tool.slug, arguments_);
    return unwrapExecutionResponse(response, "SEARCH_TOOL_EXECUTION_FAILURE");
  } catch (error: unknown) {
    if (error instanceof SearchToolExecutionFailureError) {
      throw error;
    }
    throw new SearchToolExecutionFailureError(
      `Composio could not execute discovered search tool ${tool.slug}: ${messageFor(error)}`,
      error,
    );
  }
}

export class SearchDiscoveryUnavailableError extends NonRetryableError {
  public readonly code = "SEARCH_DISCOVERY_UNAVAILABLE";

  public constructor(message: string, public readonly report: ResearchCapabilityReport) {
    super(`SEARCH_DISCOVERY_UNAVAILABLE: ${message}`);
    this.name = "SearchDiscoveryUnavailableError";
  }
}

export class SearchToolSchemaUnavailableError extends NonRetryableError {
  public readonly code = "SEARCH_TOOL_SCHEMA_UNAVAILABLE";

  public constructor(message: string) {
    super(`SEARCH_TOOL_SCHEMA_UNAVAILABLE: ${message}`);
    this.name = "SearchToolSchemaUnavailableError";
  }
}

/** Tool execution may be transient, so batch research may retry it. */
export class SearchToolExecutionFailureError extends Error {
  public readonly code = "SEARCH_TOOL_EXECUTION_FAILURE";

  public constructor(message: string, public readonly cause?: unknown) {
    super(`SEARCH_TOOL_EXECUTION_FAILURE: ${message}`);
    this.name = "SearchToolExecutionFailureError";
  }
}

/** Compatibility export retained for callers that used the original error class. */
export class RequiredSearchCapabilityUnavailableError extends SearchDiscoveryUnavailableError {}

interface DiscoveredToolSchema {
  descriptor: ResearchToolDescriptor;
  inputSchema: Record<string, unknown> | undefined;
  schemaRef: z.infer<typeof rawSchemaRefSchema> | undefined;
  primary: boolean;
}

async function discoverSearchTool(
  session: ComposioResearchSession,
  discoveryTool: ResearchToolDescriptor,
  report: ResearchCapabilityReport,
): Promise<DiscoveredToolSchema> {
  let response: unknown;
  try {
    response = await session.execute(searchDiscoveryToolSlug, discoveryArguments(discoveryTool, discoveryQuery));
  } catch (error: unknown) {
    throw new SearchDiscoveryUnavailableError(
      `COMPOSIO_SEARCH_TOOLS could not run: ${messageFor(error)}`,
      report,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = unwrapExecutionResponse(response, "SEARCH_DISCOVERY_UNAVAILABLE");
  } catch (error: unknown) {
    throw new SearchDiscoveryUnavailableError(
      `COMPOSIO_SEARCH_TOOLS returned an error: ${messageFor(error)}`,
      report,
    );
  }

  const parsed = rawDiscoveryResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SearchDiscoveryUnavailableError(
      "COMPOSIO_SEARCH_TOOLS returned no recognizable tool schemas.",
      report,
    );
  }

  const schemas = parsed.data.toolSchemas ?? parsed.data.tool_schemas ?? {};
  const primaryToolSlugs = new Set(
    (parsed.data.results ?? []).flatMap((result) => result.primaryToolSlugs ?? result.primary_tool_slugs ?? []),
  );
  const candidates = Object.entries(schemas)
    .map(([key, schema]) => discoveredSchema(key, schema, primaryToolSlugs))
    .sort((left, right) => Number(right.primary) - Number(left.primary) || compareDescriptors(left.descriptor, right.descriptor));
  const candidate = candidates.find(isUsableSearchCandidate);
  if (candidate === undefined) {
    const returned = candidates.length === 0
      ? "no tool schemas"
      : candidates.map((item) => `${item.descriptor.toolkitSlug}/${item.descriptor.slug}`).join(", ");
    throw new SearchDiscoveryUnavailableError(
      `COMPOSIO_SEARCH_TOOLS completed but did not return a usable web-search tool; returned ${returned}.`,
      report,
    );
  }
  return candidate;
}

async function resolveDiscoveredSearchTool(
  session: ComposioResearchSession,
  discovered: DiscoveredToolSchema,
  report: ResearchCapabilityReport,
): Promise<SelectedResearchTool> {
  let resolved = discovered;
  let schemaLookupRequired = false;
  if (resolved.schemaRef !== undefined) {
    schemaLookupRequired = true;
    const schemaLookupTool = report.availableMetaTools?.find((tool) => tool.slug === schemaLookupToolSlug);
    if (schemaLookupTool === undefined) {
      throw new SearchToolSchemaUnavailableError(
        `COMPOSIO_GET_TOOL_SCHEMAS is required for ${resolved.descriptor.slug} but is not exposed by this session.`,
      );
    }
    let response: unknown;
    try {
      response = await session.execute(schemaLookupToolSlug, schemaLookupArguments(resolved.schemaRef));
    } catch (error: unknown) {
      throw new SearchToolSchemaUnavailableError(
        `COMPOSIO_GET_TOOL_SCHEMAS could not fetch ${resolved.descriptor.slug}: ${messageFor(error)}`,
      );
    }
    const schema = schemaFromLookupResponse(response, resolved.descriptor.slug);
    if (schema === undefined) {
      throw new SearchToolSchemaUnavailableError(
        `COMPOSIO_GET_TOOL_SCHEMAS did not return an input schema for ${resolved.descriptor.slug}.`,
      );
    }
    resolved = {
      ...resolved,
      descriptor: { ...resolved.descriptor, inputParameters: inputParameters(schema) },
      inputSchema: schema,
      schemaRef: undefined,
    };
  }

  const parameterName = selectParameter(resolved.descriptor.inputParameters, "search");
  if (parameterName === undefined) {
    throw new SearchToolSchemaUnavailableError(
      `Discovered search tool ${resolved.descriptor.slug} has no supported query input in its Composio schema.`,
    );
  }

  return {
    ...resolved.descriptor,
    parameterName,
    executionMechanism: "multi_execute",
    discoveredVia: "COMPOSIO_SEARCH_TOOLS",
    schemaLookupRequired,
  };
}

function schemaFromLookupResponse(response: unknown, slug: string): Record<string, unknown> | undefined {
  let payload: Record<string, unknown>;
  try {
    payload = unwrapExecutionResponse(response, "SEARCH_TOOL_SCHEMA_UNAVAILABLE");
  } catch {
    return undefined;
  }
  const parsed = rawDiscoveryResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const schema = (parsed.data.toolSchemas ?? parsed.data.tool_schemas ?? {})[slug];
  return schema?.inputSchema ?? schema?.input_schema;
}

function discoveredSchema(
  key: string,
  schema: z.infer<typeof rawDiscoveredToolSchema>,
  primaryToolSlugs: ReadonlySet<string>,
): DiscoveredToolSchema {
  const slug = schema.toolSlug ?? schema.tool_slug ?? key;
  const inputSchema = schema.inputSchema ?? schema.input_schema;
  return {
    descriptor: {
      slug,
      name: slug,
      description: schema.description ?? "UNKNOWN",
      toolkitSlug: schema.toolkit,
      toolkitName: schema.toolkit,
      inputParameters: inputParameters(inputSchema),
    },
    inputSchema,
    schemaRef: schema.schemaRef,
    primary: primaryToolSlugs.has(key) || primaryToolSlugs.has(slug),
  };
}

function discoveryArguments(tool: ResearchToolDescriptor, query: string): Record<string, unknown> {
  if (tool.inputParameters.includes("queries")) {
    return { queries: [{ use_case: query }] };
  }
  if (tool.inputParameters.includes("query")) {
    return { query };
  }
  if (tool.inputParameters.includes("use_case")) {
    return { use_case: query };
  }
  throw new SearchDiscoveryUnavailableError(
    "COMPOSIO_SEARCH_TOOLS exposes no supported discovery-query input.",
    emptyCapabilityReport(),
  );
}

function schemaLookupArguments(schemaRef: z.infer<typeof rawSchemaRefSchema>): Record<string, unknown> {
  const toolSlugs = schemaRef.args.toolSlugs ?? schemaRef.args.tool_slugs;
  if (toolSlugs === undefined || toolSlugs.length === 0) {
    throw new SearchToolSchemaUnavailableError("The discovered schemaRef did not name any tool slugs.");
  }
  return { tool_slugs: toolSlugs };
}

function unwrapExecutionResponse(response: unknown, code: string): Record<string, unknown> {
  if (typeof response !== "object" || response === null) {
    throw new Error(`${code}: Composio returned a non-object response.`);
  }
  const record = response as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    throw new Error(`${code}: ${record.error}`);
  }
  if (typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

function describeTool(tool: ToolList[number]): ResearchToolDescriptor {
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description ?? "UNKNOWN",
    toolkitSlug: tool.toolkit?.slug ?? "UNKNOWN",
    toolkitName: tool.toolkit?.name ?? "UNKNOWN",
    inputParameters: Object.keys(tool.inputParameters?.properties ?? {}).sort(),
  };
}

function inputParameters(schema: Record<string, unknown> | undefined): string[] {
  if (schema === undefined || typeof schema.properties !== "object" || schema.properties === null) {
    return [];
  }
  return Object.keys(schema.properties as Record<string, unknown>).sort();
}

function uniqueToolkits(tools: readonly ResearchToolDescriptor[]): Array<{ slug: string; name: string }> {
  const bySlug = new Map<string, { slug: string; name: string }>();
  for (const tool of tools) {
    if (!bySlug.has(tool.toolkitSlug)) {
      bySlug.set(tool.toolkitSlug, { slug: tool.toolkitSlug, name: tool.toolkitName });
    }
  }
  return [...bySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

type UnmarkedSelection = Omit<SelectedResearchTool, "executionMechanism" | "discoveredVia" | "schemaLookupRequired">;

function selectTool(
  tools: readonly ResearchToolDescriptor[],
  capability: "search" | "fetch",
): UnmarkedSelection | undefined {
  const candidates = tools
    .map((tool) => toCandidate(tool, capability))
    .filter((candidate): candidate is UnmarkedSelection & { priority: number } => candidate !== undefined)
    .sort((left, right) =>
      left.priority - right.priority ||
      left.toolkitSlug.localeCompare(right.toolkitSlug) ||
      left.slug.localeCompare(right.slug),
    );
  const candidate = candidates[0];
  if (candidate === undefined) {
    return undefined;
  }
  const { priority: _priority, ...selected } = candidate;
  return selected;
}

function toDirectSelection(selection: UnmarkedSelection): SelectedResearchTool {
  return {
    ...selection,
    executionMechanism: "direct",
    discoveredVia: "direct_session_tool",
    schemaLookupRequired: false,
  };
}

function toCandidate(
  tool: ResearchToolDescriptor,
  capability: "search" | "fetch",
): (UnmarkedSelection & { priority: number }) | undefined {
  const parameterName = selectParameter(tool.inputParameters, capability);
  if (parameterName === undefined || !hasCapabilityLanguage(tool, capability)) {
    return undefined;
  }
  return { ...tool, parameterName, priority: selectionPriority(tool, capability) };
}

function selectParameter(parameters: readonly string[], capability: "search" | "fetch"): string | undefined {
  const preferred = capability === "search"
    ? ["query", "search", "q", "keywords", "text"]
    : ["url", "uri", "link"];
  return preferred.find((name) => parameters.some((parameter) => parameter.toLocaleLowerCase("en-US") === name));
}

function hasCapabilityLanguage(tool: ResearchToolDescriptor, capability: "search" | "fetch"): boolean {
  const text = `${tool.slug} ${tool.name} ${tool.description} ${tool.toolkitSlug} ${tool.toolkitName}`
    .toLocaleLowerCase("en-US");
  return capability === "search"
    ? /search|web|lookup|query/.test(text)
    : /fetch|content|document|page|url/.test(text);
}

function isSearchLike(tool: ResearchToolDescriptor): boolean {
  const text = `${tool.slug} ${tool.name} ${tool.description}`.toLocaleLowerCase("en-US");
  if (/fetch|url[ _-]?content|page[ _-]?content|retrieve[ _-]?(page|url)/.test(text)) {
    return false;
  }
  return /search|web|lookup|query/.test(text);
}

function isUsableSearchCandidate(candidate: DiscoveredToolSchema): boolean {
  const hasQueryInput = selectParameter(candidate.descriptor.inputParameters, "search") !== undefined;
  return isSearchLike(candidate.descriptor) && (hasQueryInput || candidate.schemaRef !== undefined);
}

function isMetaTool(tool: ResearchToolDescriptor): boolean {
  return tool.slug.startsWith("COMPOSIO_");
}

function selectionPriority(tool: ResearchToolDescriptor, capability: "search" | "fetch"): number {
  const toolkit = `${tool.toolkitSlug} ${tool.toolkitName}`.toLocaleLowerCase("en-US");
  const text = `${tool.slug} ${tool.name} ${tool.description}`.toLocaleLowerCase("en-US");
  if (toolkit.includes(capability)) {
    return 1;
  }
  if (text.includes(capability)) {
    return 2;
  }
  return 3;
}

function compareDescriptors(left: ResearchToolDescriptor, right: ResearchToolDescriptor): number {
  return left.toolkitSlug.localeCompare(right.toolkitSlug) || left.slug.localeCompare(right.slug);
}

function emptyCapabilityReport(): ResearchCapabilityReport {
  return {
    availableToolkits: [],
    availableTools: [],
    availableMetaTools: [],
    selectedSearchTool: undefined,
    selectedFetchTool: undefined,
  };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
