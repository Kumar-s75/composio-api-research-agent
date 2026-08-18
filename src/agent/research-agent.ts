import type { ComposioResearchClient, ComposioResearchSession } from "../config/composio.js";
import {
  extractCollectedSources,
  hasUnknownFindings,
  reconcileEvidenceBackedFindings,
  rankSourcesForInspection,
  retainCollectedEvidence,
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
  executeSearchTool,
  preflightResearchCapabilities,
  requireSearchCapability,
  type ResearchCapabilityReport,
  type SelectedResearchTool,
} from "../research/composio-preflight.js";
import {
  scoreBuildability,
  type DeterministicBuildabilityAssessment,
} from "../scoring/buildability.js";
import { normalizedResearchResultSchema, type NormalizedResearchResult } from "../types/research-result.js";
import { buildResearchSynthesisPrompt, researchPromptVersion } from "./prompts.js";

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

/** Raw model output and collected sources are retained alongside the normalized finding. */
export interface ResearchArtifact {
  rawResearch: unknown;
  collectedSources: readonly CollectedSource[];
  normalizedResearch: NormalizedResearchResult;
  deterministicBuildability: DeterministicBuildabilityAssessment;
  capabilityReport: ResearchCapabilityReport;
}

interface ResearchToolAvailability {
  searchTool: SelectedResearchTool;
  fetchTool: SelectedResearchTool | undefined;
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
    return (await this.researchWithArtifact(application)).normalizedResearch;
  }

  public async researchWithArtifact(application: unknown): Promise<ResearchArtifact> {
    const app = researchAppSchema.parse(application);
    const preflight = await preflightResearchCapabilities(this.options.client, `research-${app.id}`);
    const session = preflight.session;
    const availability: ResearchToolAvailability = {
      searchTool: requireSearchCapability(preflight.report),
      fetchTool: preflight.report.selectedFetchTool,
    };
    const strategy = createSearchStrategy(app);
    let collectedSources: CollectedSource[] = [];
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const queries = attempt === 1 ? strategy.initial : strategy.fallback;
      try {
        const searchSources = await this.runSearches(session, availability.searchTool, queries);
        collectedSources = mergeSources(collectedSources, searchSources);

        if (availability.fetchTool !== undefined) {
          const fetchedSources = await this.fetchPreferredSources(session, availability.fetchTool, collectedSources);
          collectedSources = mergeSources(collectedSources, fetchedSources);
        }

        const rawResearch = await this.options.resultGenerator.generate({
          prompt: buildResearchSynthesisPrompt(app, collectedSources),
          app,
          sources: collectedSources,
          promptVersion: researchPromptVersion,
        });
        const candidate = withComposioSearchMetadata(
          normalizedResearchResultSchema.parse(rawResearch),
          availability.searchTool,
        );

        assertAppIdentity(candidate, app);
        const sourceBoundCandidate = retainCollectedEvidence(candidate, collectedSources);
        const evidenceBackedCandidate = normalizedResearchResultSchema.parse(
          reconcileEvidenceBackedFindings(sourceBoundCandidate, collectedSources),
        );
        const evidenceAssessment = validateEvidenceCoverage(evidenceBackedCandidate, collectedSources);
        const assessedCandidate = applyEvidenceConfidence(
          evidenceBackedCandidate,
          evidenceAssessment.should_mark_low_confidence,
        );

        if (!hasUnknownFindings(assessedCandidate) || attempt === this.maxAttempts) {
          const deterministicBuildability = scoreBuildability(assessedCandidate);
          return {
            rawResearch,
            collectedSources,
            normalizedResearch: applyDeterministicBuildability(
              assessedCandidate,
              deterministicBuildability,
            ),
            deterministicBuildability,
            capabilityReport: preflight.report,
          };
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

  private async runSearches(
    session: ComposioResearchSession,
    searchTool: SelectedResearchTool,
    queries: readonly SearchQuery[],
  ): Promise<CollectedSource[]> {
    const sources: CollectedSource[] = [];

    for (const query of queries) {
      const response = await executeSearchTool(session, searchTool, query.query);
      sources.push(...extractCollectedSources(response, { origin: "search" }));
    }

    return sources;
  }

  private async fetchPreferredSources(
    session: ComposioResearchSession,
    fetchTool: SelectedResearchTool,
    sources: readonly CollectedSource[],
  ): Promise<CollectedSource[]> {
    const selectedSources = rankSourcesForInspection(sources).slice(0, this.maxFetchedSources);
    const fetchedSources: CollectedSource[] = [];

    for (const source of selectedSources) {
      const response = await session.execute(fetchTool.slug, { [fetchTool.parameterName]: source.url });
      fetchedSources.push(...extractCollectedSources(response, { origin: "fetch" }));
    }

    return fetchedSources;
  }

}

function withComposioSearchMetadata(
  result: NormalizedResearchResult,
  searchTool: SelectedResearchTool,
): NormalizedResearchResult {
  return {
    ...result,
    research_metadata: {
      ...result.research_metadata,
      composio_search: {
        tool_slug: searchTool.slug,
        toolkit: searchTool.toolkitSlug,
        discovered_via: searchTool.discoveredVia,
        schema_lookup_required: searchTool.schemaLookupRequired,
      },
    },
  };
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

function applyDeterministicBuildability(
  result: NormalizedResearchResult,
  assessment: DeterministicBuildabilityAssessment,
): NormalizedResearchResult {
  const verdict = {
    EASY: "buildable",
    MODERATE: "partially_buildable",
    DIFFICULT: "not_buildable",
    BLOCKED: "not_buildable",
    UNKNOWN: "UNKNOWN",
  } as const;
  const rationale =
    assessment.score === "UNKNOWN"
      ? "Deterministic buildability scoring could not establish a documented public API."
      : `Deterministic score ${assessment.score}/10: ${assessment.reasons.join(", ") || "no supported factors"}.`;

  return {
    ...result,
    buildability: {
      verdict: verdict[assessment.verdict],
      score: assessment.score === "UNKNOWN" ? "UNKNOWN" : assessment.score,
      blocker: assessment.blocker,
      rationale,
    },
  };
}

function assertAppIdentity(result: NormalizedResearchResult, app: ResearchApp): void {
  if (result.app.id !== app.id || result.app.name !== app.name || result.app.category !== app.category) {
    throw new Error("The generated research result does not match the requested application.");
  }
}
