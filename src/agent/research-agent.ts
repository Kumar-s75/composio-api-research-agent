import type { ComposioResearchClient, ComposioResearchSession } from "../config/composio.js";
import {
  extractCollectedSources,
  hasUnknownFindings,
  rankSourcesForInspection,
  validateEvidenceCoverage,
  type CollectedSource,
} from "../research/evidence-extractor.js";
import {
  createSearchStrategy,
  researchAppSchema,
  type ResearchApp,
  type SearchQuery,
} from "../research/search-strategy.js";
import {
  createResearchSession,
  discoverResearchTools,
  getResearchSessionTools,
} from "../research/composio-tools.js";
import { normalizedResearchResultSchema, type NormalizedResearchResult } from "../types/research-result.js";
import { buildResearchSynthesisPrompt, researchPromptVersion } from "./prompts.js";

const webSearchToolSlugs = ["COMPOSIO_SEARCH_WEB", "COMPOSIO_SEARCH_DUCK_DUCK_GO"] as const;
const fetchUrlContentToolSlug = "COMPOSIO_SEARCH_FETCH_URL_CONTENT";
const browserTaskToolSlug = "BROWSER_TOOL_CREATE_TASK";

export interface StructuredResearchResultGenerator {
  generate(input: {
    prompt: string;
    app: ResearchApp;
    sources: readonly CollectedSource[];
    promptVersion: string;
  }): Promise<unknown>;
}

export interface ApiResearchAgentOptions {
  client: ComposioResearchClient;
  resultGenerator: StructuredResearchResultGenerator;
  maxAttempts?: number;
  maxFetchedSources?: number;
}

interface ResearchToolAvailability {
  webSearchToolSlug: string;
  canFetchUrlContent: boolean;
  canUseBrowser: boolean;
}

/**
 * First-pass, single-app API researcher. It gathers a bounded source corpus
 * through Composio and delegates structured synthesis to an injected model.
 * It intentionally does not schedule or parallelize the 100-app dataset.
 */
export class ApiResearchAgent {
  private readonly maxAttempts: number;
  private readonly maxFetchedSources: number;

  public constructor(private readonly options: ApiResearchAgentOptions) {
    this.maxAttempts = validateBoundedLimit(options.maxAttempts ?? 2, "maxAttempts", 3);
    this.maxFetchedSources = validateBoundedLimit(
      options.maxFetchedSources ?? 6,
      "maxFetchedSources",
      10,
    );
  }

  public async research(application: unknown): Promise<NormalizedResearchResult> {
    const app = researchAppSchema.parse(application);
    const session = await createResearchSession(this.options.client, {
      userId: `research-${app.id}`,
    });
    const availability = await this.getToolAvailability(session);
    const strategy = createSearchStrategy(app);
    let collectedSources: CollectedSource[] = [];
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const queries = attempt === 1 ? strategy.initial : strategy.fallback;
      try {
        const searchSources = await this.runSearches(session, availability.webSearchToolSlug, queries);
        collectedSources = mergeSources(collectedSources, searchSources);

        if (availability.canFetchUrlContent) {
          const fetchedSources = await this.fetchPreferredSources(session, collectedSources);
          collectedSources = mergeSources(collectedSources, fetchedSources);
        }

        if (attempt > 1 && availability.canUseBrowser) {
          const browserSources = await this.inspectWithBrowser(session, collectedSources);
          collectedSources = mergeSources(collectedSources, browserSources);
        }

        const candidate = normalizedResearchResultSchema.parse(
          await this.options.resultGenerator.generate({
            prompt: buildResearchSynthesisPrompt(app, collectedSources),
            app,
            sources: collectedSources,
            promptVersion: researchPromptVersion,
          }),
        );

        assertAppIdentity(candidate, app);
        const evidenceAssessment = validateEvidenceCoverage(candidate, collectedSources);
        const assessedCandidate = applyEvidenceConfidence(candidate, evidenceAssessment.should_mark_low_confidence);

        if (!hasUnknownFindings(assessedCandidate) || attempt === this.maxAttempts) {
          return assessedCandidate;
        }
      } catch (error: unknown) {
        lastError = error;
        if (attempt === this.maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Research agent exhausted its bounded retry limit.");
  }

  private async getToolAvailability(session: ComposioResearchSession): Promise<ResearchToolAvailability> {
    const rawTools = await getResearchSessionTools(this.options.client, session);
    const slugs = new Set(rawTools.map((tool) => tool.slug));
    const webSearchToolSlug = webSearchToolSlugs.find((slug) => slugs.has(slug));

    if (webSearchToolSlug === undefined) {
      throw new Error("The Composio research session does not expose a web-search tool.");
    }

    // Session search discovers other suitable tools and keeps tool selection session-scoped.
    await discoverResearchTools(session, "web search, fetch URL content, and browser interaction");

    return {
      webSearchToolSlug,
      canFetchUrlContent: slugs.has(fetchUrlContentToolSlug),
      canUseBrowser: slugs.has(browserTaskToolSlug),
    };
  }

  private async runSearches(
    session: ComposioResearchSession,
    webSearchToolSlug: string,
    queries: readonly SearchQuery[],
  ): Promise<CollectedSource[]> {
    const sources: CollectedSource[] = [];

    for (const query of queries) {
      const response = await session.execute(webSearchToolSlug, { query: query.query });
      sources.push(...extractCollectedSources(response, { origin: "search" }));
    }

    return sources;
  }

  private async fetchPreferredSources(
    session: ComposioResearchSession,
    sources: readonly CollectedSource[],
  ): Promise<CollectedSource[]> {
    const selectedSources = rankSourcesForInspection(sources).slice(0, this.maxFetchedSources);
    const fetchedSources: CollectedSource[] = [];

    for (const source of selectedSources) {
      const response = await session.execute(fetchUrlContentToolSlug, { url: source.url });
      fetchedSources.push(...extractCollectedSources(response, { origin: "fetch" }));
    }

    return fetchedSources;
  }

  private async inspectWithBrowser(
    session: ComposioResearchSession,
    sources: readonly CollectedSource[],
  ): Promise<CollectedSource[]> {
    const source = rankSourcesForInspection(sources)[0];
    if (source === undefined) {
      return [];
    }

    try {
      const response = await session.execute(browserTaskToolSlug, {
        task: `Open ${source.url} and return the page title and relevant developer API, authentication, pricing, or MCP information.`,
      });
      return extractCollectedSources(response, { origin: "browser" });
    } catch {
      // Browser availability is optional; do not turn an unavailable browser into a negative app claim.
      return [];
    }
  }
}

function validateBoundedLimit(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function mergeSources(
  existing: readonly CollectedSource[],
  incoming: readonly CollectedSource[],
): CollectedSource[] {
  const byUrl = new Map(existing.map((source) => [new URL(source.url).toString(), source]));
  for (const source of incoming) {
    const key = new URL(source.url).toString();
    const current = byUrl.get(key);
    if (current === undefined || sourceOriginRank(source.origin) < sourceOriginRank(current.origin)) {
      byUrl.set(key, source);
    }
  }
  return [...byUrl.values()];
}

function sourceOriginRank(origin: CollectedSource["origin"]): number {
  return { browser: 1, fetch: 2, search: 3 }[origin];
}

function applyEvidenceConfidence(
  result: NormalizedResearchResult,
  shouldMarkLowConfidence: boolean,
): NormalizedResearchResult {
  if (!shouldMarkLowConfidence || result.research_metadata.confidence === "UNKNOWN") {
    return result;
  }

  return {
    ...result,
    research_metadata: {
      ...result.research_metadata,
      confidence: "low",
    },
  };
}

function assertAppIdentity(result: NormalizedResearchResult, app: ResearchApp): void {
  if (result.app.id !== app.id || result.app.name !== app.name || result.app.category !== app.category) {
    throw new Error("The generated research result does not match the requested application.");
  }
}
