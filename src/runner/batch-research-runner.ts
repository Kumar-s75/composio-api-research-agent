import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { loadAppInputDataset } from "../config/apps.js";
import type { AppInput } from "../types/apps.js";
import { normalizedResearchResultSchema, type NormalizedResearchResult } from "../types/research-result.js";
import { createConcurrencyLimit } from "../utils/concurrency.js";
import { isNonRetryableError } from "../utils/non-retryable-error.js";
import type { ResearchArtifact } from "../agent/research-agent.js";

const confidenceValue = {
  very_low: 1,
  low: 2,
  medium: 3,
  high: 4,
  very_high: 5,
} as const;

const runMetadataSchema = z
  .object({
    run_id: z.string().min(1),
    created_at: z.string().datetime({ offset: true }),
    app_count: z.number().int().nonnegative(),
    max_retries: z.number().int().nonnegative(),
  })
  .strict();

const errorArtifactSchema = z
  .object({
    app_id: z.string().min(1),
    occurred_at: z.string().datetime({ offset: true }),
    attempts: z.array(
      z
        .object({
          attempt: z.number().int().positive(),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export interface RunnableResearchAgent {
  researchWithArtifact(application: unknown): Promise<ResearchArtifact>;
}

export interface BatchResearchRunnerOptions {
  agent: RunnableResearchAgent;
  concurrency: number;
  maxRetries?: number;
  runsDirectory?: string;
  runId?: string;
  now?: () => Date;
  loadApps?: () => Promise<readonly AppInput[]>;
}

export interface BatchResearchSummary {
  runId: string;
  total: number;
  successful: number;
  failed: number;
  retried: number;
  averageConfidence: number | "UNKNOWN";
  confidenceSampleSize: number;
  durationMs: number;
}

interface WorkResult {
  status: "successful" | "failed" | "skipped";
  retried: number;
  confidence?: NormalizedResearchResult["research_metadata"]["confidence"];
}

/**
 * Persisted batch orchestration. Every successful app has a raw artifact and
 * normalized result, while recoverable failures are retained under errors/.
 */
export class BatchResearchRunner {
  private readonly maxRetries: number;
  private readonly runsDirectory: string;
  private readonly now: () => Date;
  private readonly loadApps: () => Promise<readonly AppInput[]>;

  public constructor(private readonly options: BatchResearchRunnerOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("concurrency must be a positive integer.");
    }
    this.maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 5) {
      throw new Error("maxRetries must be an integer between 0 and 5.");
    }
    this.runsDirectory = options.runsDirectory ?? "data/runs";
    this.now = options.now ?? (() => new Date());
    this.loadApps = options.loadApps ?? (() => loadAppInputDataset());
  }

  public async run(): Promise<BatchResearchSummary> {
    const apps = await this.loadApps();
    return this.runApps(apps);
  }

  public async runSingle(appId: string): Promise<BatchResearchSummary> {
    const apps = await this.loadApps();
    const app = apps.find((candidate) => appIdFromName(candidate.name) === appId);
    if (app === undefined) {
      throw new Error(`Unknown app ID: ${appId}.`);
    }
    return this.runApps([app]);
  }

  /** Runs an explicit, validated list while reusing the normal batch workflow. */
  public async runSelected(selectors: readonly string[]): Promise<BatchResearchSummary> {
    if (selectors.length === 0) {
      throw new Error("At least one app selector is required.");
    }
    const apps = await this.loadApps();
    const selectedApps: AppInput[] = [];
    const unknownSelectors: string[] = [];
    const selectedNumbers = new Set<number>();

    for (const selector of selectors) {
      const normalizedSelector = normalizeAppSelector(selector);
      const app = apps.find(
        (candidate) =>
          appIdFromName(candidate.name) === normalizedSelector ||
          normalizeAppSelector(candidate.name) === normalizedSelector,
      );
      if (app === undefined) {
        unknownSelectors.push(selector);
      } else if (!selectedNumbers.has(app.number)) {
        selectedApps.push(app);
        selectedNumbers.add(app.number);
      }
    }

    if (unknownSelectors.length > 0) {
      throw new Error(`Unknown app selector(s): ${unknownSelectors.join(", ")}.`);
    }
    return this.runApps(selectedApps);
  }

  private async runApps(apps: readonly AppInput[]): Promise<BatchResearchSummary> {
    const startedAt = this.now();
    const runId = this.options.runId ?? createRunId(startedAt);
    const runDirectory = join(this.runsDirectory, runId);
    await this.initializeRun(runDirectory, runId, apps.length);

    const limit = createConcurrencyLimit(this.options.concurrency);
    const outcomes = await Promise.all(
      apps.map((app) => limit(() => this.processApp(app, runDirectory))),
    );
    const successful = outcomes.filter((outcome) => outcome.status === "successful").length;
    const skipped = outcomes.filter((outcome) => outcome.status === "skipped").length;
    const knownConfidence = outcomes
      .map((outcome) => outcome.confidence)
      .filter((confidence): confidence is keyof typeof confidenceValue =>
        confidence !== undefined && confidence !== "UNKNOWN",
      )
      .map((confidence) => confidenceValue[confidence]);
    const durationMs = Math.max(0, this.now().getTime() - startedAt.getTime());
    const summary: BatchResearchSummary = {
      runId,
      total: apps.length,
      successful: successful + skipped,
      failed: outcomes.filter((outcome) => outcome.status === "failed").length,
      retried: outcomes.reduce((total, outcome) => total + outcome.retried, 0),
      averageConfidence:
        knownConfidence.length === 0
          ? "UNKNOWN"
          : Number((knownConfidence.reduce((sum, value) => sum + value, 0) / knownConfidence.length).toFixed(2)),
      confidenceSampleSize: knownConfidence.length,
      durationMs,
    };
    await writeJson(join(runDirectory, "summary.json"), summary);
    return summary;
  }

  private async initializeRun(runDirectory: string, runId: string, appCount: number): Promise<void> {
    await Promise.all(
      ["raw", "normalized", "errors", "capabilities"].map((directory) =>
        mkdir(join(runDirectory, directory), { recursive: true }),
      ),
    );
    const manifestPath = join(runDirectory, "manifest.json");
    if (await fileExists(manifestPath)) {
      runMetadataSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
      return;
    }
    await writeJson(
      manifestPath,
      runMetadataSchema.parse({
        run_id: runId,
        created_at: this.now().toISOString(),
        app_count: appCount,
        max_retries: this.maxRetries,
      }),
    );
  }

  private async processApp(app: AppInput, runDirectory: string): Promise<WorkResult> {
    const researchApp = toResearchApp(app);
    const normalizedPath = join(runDirectory, "normalized", `${researchApp.id}.json`);
    if (await fileExists(normalizedPath)) {
      const normalized = normalizedResearchResultSchema.parse(JSON.parse(await readFile(normalizedPath, "utf8")));
      return { status: "skipped", retried: 0, confidence: normalized.research_metadata.confidence };
    }

    const attempts: Array<{ attempt: number; message: string }> = [];
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      try {
        const artifact = await this.options.agent.researchWithArtifact(researchApp);
        await Promise.all([
          writeJson(join(runDirectory, "raw", `${researchApp.id}.json`), artifact.rawResearch),
          writeJson(join(runDirectory, "normalized", `${researchApp.id}.json`), artifact.normalizedResearch),
          writeJson(join(runDirectory, "sources", `${researchApp.id}.json`), artifact.collectedSources),
          writeJson(join(runDirectory, "capabilities", `${researchApp.id}.json`), artifact.capabilityReport),
        ]);
        if (attempts.length > 0) {
          await this.writeErrorArtifact(researchApp.id, runDirectory, attempts);
        }
        return {
          status: "successful",
          retried: attempt - 1,
          confidence: artifact.normalizedResearch.research_metadata.confidence,
        };
      } catch (error: unknown) {
        attempts.push({ attempt, message: errorMessage(error) });
        if (isNonRetryableError(error)) {
          break;
        }
      }
    }
    await this.writeErrorArtifact(researchApp.id, runDirectory, attempts);
    return { status: "failed", retried: Math.max(0, attempts.length - 1) };
  }

  private async writeErrorArtifact(
    appId: string,
    runDirectory: string,
    attempts: ReadonlyArray<{ attempt: number; message: string }>,
  ): Promise<void> {
    await writeJson(
      join(runDirectory, "errors", `${appId}.json`),
      errorArtifactSchema.parse({
        app_id: appId,
        occurred_at: this.now().toISOString(),
        attempts,
      }),
    );
  }
}

export function toResearchApp(app: AppInput): { id: string; name: string; category: AppInput["category"] } {
  return { id: appIdFromName(app.name), name: app.name, category: app.category };
}

export function appIdFromName(name: string): string {
  const id = name
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (id.length === 0) {
    throw new Error(`Cannot derive an app ID from ${name}.`);
  }
  return id;
}

function normalizeAppSelector(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function createRunId(date: Date): string {
  return `run-${date.toISOString().replaceAll(/[:.]/g, "-")}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
