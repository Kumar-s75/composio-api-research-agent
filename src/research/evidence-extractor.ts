import { z } from "zod";

import type { Evidence, NormalizedResearchResult } from "../types/research-result.js";

export const collectedSourceSchema = z
  .object({
    url: z.string().url(),
    page_title: z.union([z.string().min(1), z.literal("UNKNOWN")]),
    summary: z.string().min(1),
    origin: z.enum(["search", "fetch", "browser"]),
    retrieved_at: z.string().datetime({ offset: true }),
  })
  .strict();

export interface ExtractEvidenceOptions {
  origin: z.infer<typeof collectedSourceSchema>["origin"];
  maxSources?: number;
}

export type CollectedSource = z.infer<typeof collectedSourceSchema>;

export interface EvidenceQualityAssessment {
  missing_fields: Array<Evidence["normalized_field"]>;
  weakly_supported_fields: Array<Evidence["normalized_field"]>;
  conflicting_fields: Array<Evidence["normalized_field"]>;
  pricing_or_access_unclear: boolean;
  mcp_unclear: boolean;
  should_mark_low_confidence: boolean;
}

const urlKeys = ["url", "link", "href", "source_url"];
const titleKeys = ["title", "name", "heading"];
const summaryKeys = ["snippet", "summary", "description", "content", "text", "body"];

/**
 * Extracts URLs and short source context from varied tool-response shapes. It
 * does not mark a source as official; official ownership must be established
 * from the retrieved content by a later synthesis/verification step.
 */
export function extractCollectedSources(
  value: unknown,
  options: ExtractEvidenceOptions,
): CollectedSource[] {
  const sources: CollectedSource[] = [];
  const seenObjects = new WeakSet<object>();
  const maxSources = options.maxSources ?? 20;

  visit(value, options.origin, sources, seenObjects, maxSources);
  return deduplicateCollectedSources(sources);
}

/** Ranks developer/API-looking pages ahead of generic result pages for fetching. */
export function rankSourcesForInspection(sources: readonly CollectedSource[]): CollectedSource[] {
  return [...sources].sort((left, right) => scoreSource(right) - scoreSource(left));
}

export const sourceTypeRank = {
  official_developer_documentation: 1,
  official_api_documentation: 2,
  official_pricing_or_developer_page: 3,
  official_github_repository: 4,
  official_mcp_documentation_or_repository: 5,
  reputable_third_party_documentation: 6,
  search_snippet: 7,
} as const;

/** Ranks normalized evidence according to the documented source-preference policy. */
export function rankEvidenceSources(evidence: readonly Evidence[]): Evidence[] {
  return [...evidence].sort(
    (left, right) => sourceTypeRank[left.source_type] - sourceTypeRank[right.source_type],
  );
}

/**
 * Confirms that a synthesized result only cites URLs collected during this run
 * and that every known material finding has a top-level evidence record.
 */
export function validateEvidenceCoverage(
  result: NormalizedResearchResult,
  collectedSources: readonly CollectedSource[],
): EvidenceQualityAssessment {
  const sourceByUrl = new Map(
    collectedSources.map((source) => [normalizeUrl(source.url), source]),
  );
  const evidence = [...result.evidence, ...result.api.mcp_evidence];

  for (const item of evidence) {
    const collectedSource = sourceByUrl.get(normalizeUrl(item.source_url));
    if (collectedSource === undefined) {
      throw new Error(`Evidence URL was not collected during this run: ${item.source_url}`);
    }
    if (item.retrieved_at !== collectedSource.retrieved_at) {
      throw new Error(`Evidence retrieval timestamp does not match the collected source: ${item.source_url}`);
    }
    if (
      collectedSource.page_title !== "UNKNOWN" &&
      item.page_title !== "UNKNOWN" &&
      item.page_title !== collectedSource.page_title
    ) {
      throw new Error(`Evidence page title does not match the collected source: ${item.source_url}`);
    }
    if (item.source_type === "search_snippet" && collectedSource.origin !== "search") {
      throw new Error(`Search-snippet evidence must originate from a search result: ${item.source_url}`);
    }
  }

  assertAuthenticationEvidence(result, sourceByUrl);

  const assessment = assessEvidenceQuality(result);
  for (const field of assessment.missing_fields) {
    throw new Error(`Missing evidence for material claim: ${field}`);
  }

  for (const item of result.evidence) {
    if (item.source_type !== "search_snippet") {
      continue;
    }
    const source = sourceByUrl.get(normalizeUrl(item.source_url));
    if (source?.origin !== "search") {
      continue;
    }
    const fetchedPageExists = collectedSources.some(
      (candidate) =>
        candidate.origin !== "search" && normalizeUrl(candidate.url) === normalizeUrl(item.source_url),
    );
    if (fetchedPageExists) {
      throw new Error(`Search snippets cannot be strong evidence when the page was fetched: ${item.source_url}`);
    }
  }

  return assessment;
}

/**
 * Retains only citations that exactly match the collected source corpus. Any
 * discarded model citation is not accepted as evidence; reconciliation will
 * subsequently demote claims it can no longer support to UNKNOWN.
 */
export function retainCollectedEvidence(
  result: NormalizedResearchResult,
  collectedSources: readonly CollectedSource[],
): NormalizedResearchResult {
  const sourceByUrl = new Map(
    collectedSources.map((source) => [normalizeUrl(source.url), source]),
  );
  const isCollectedEvidence = (item: Evidence): boolean => {
    const source = sourceByUrl.get(normalizeUrl(item.source_url));
    return source !== undefined &&
      item.retrieved_at === source.retrieved_at &&
      (source.page_title === "UNKNOWN" || item.page_title === "UNKNOWN" || item.page_title === source.page_title) &&
      (item.source_type !== "search_snippet" || source.origin === "search");
  };

  return {
    ...result,
    evidence: result.evidence.filter(isCollectedEvidence),
    api: {
      ...result.api,
      mcp_evidence: result.api.mcp_evidence.filter(isCollectedEvidence),
    },
  };
}

/**
 * Removes unsupported certainty before final evidence validation. This is
 * intentionally conservative: when the collected source corpus does not
 * support a material field, its canonical UNKNOWN representation is used.
 */
export function reconcileEvidenceBackedFindings(
  result: NormalizedResearchResult,
  collectedSources: readonly CollectedSource[],
): NormalizedResearchResult {
  const sourceByUrl = new Map(
    collectedSources.map((source) => [normalizeUrl(source.url), source]),
  );
  const hasEvidence = (field: Evidence["normalized_field"]): boolean =>
    result.evidence.some((item) =>
      item.normalized_field === field && sourceByUrl.has(normalizeUrl(item.source_url)),
    );
  const authenticationMethods: NormalizedResearchResult["authentication"]["methods"] = result.authentication.methods.every((method) =>
    method === "UNKNOWN" ||
    hasDirectAuthenticationEvidence(result.evidence, sourceByUrl, "authentication.methods", method),
  )
    ? result.authentication.methods
    : ["UNKNOWN"];
  const authenticationPrimaryMethod =
    result.authentication.primary_method === "UNKNOWN" ||
    hasDirectAuthenticationEvidence(
      result.evidence,
      sourceByUrl,
      "authentication.primary_method",
      result.authentication.primary_method,
    )
      ? result.authentication.primary_method
      : "UNKNOWN";
  const mcpHasRequiredEvidence =
    result.api.mcp !== "official" && result.api.mcp !== "community"
      ? true
      : result.api.mcp_evidence.length > 0;

  return {
    ...result,
    app: {
      ...result.app,
      description: hasEvidence("app.description") ? result.app.description : "UNKNOWN",
    },
    authentication: {
      methods: authenticationMethods,
      primary_method: authenticationPrimaryMethod,
      notes: hasEvidence("authentication.notes") ? result.authentication.notes : "UNKNOWN",
    },
    credential_access: {
      model: hasEvidence("credential_access.model") ? result.credential_access.model : "UNKNOWN",
      free: hasEvidence("credential_access.free") ? result.credential_access.free : "UNKNOWN",
      trial: hasEvidence("credential_access.trial") ? result.credential_access.trial : "UNKNOWN",
      paid_plan: hasEvidence("credential_access.paid_plan") ? result.credential_access.paid_plan : "UNKNOWN",
      admin_approval: hasEvidence("credential_access.admin_approval")
        ? result.credential_access.admin_approval
        : "UNKNOWN",
      partner_required: hasEvidence("credential_access.partner_required")
        ? result.credential_access.partner_required
        : "UNKNOWN",
      contact_sales: hasEvidence("credential_access.contact_sales")
        ? result.credential_access.contact_sales
        : "UNKNOWN",
      notes: hasEvidence("credential_access.notes") ? result.credential_access.notes : "UNKNOWN",
    },
    api: {
      ...result.api,
      documented: hasEvidence("api.documented") ? result.api.documented : "UNKNOWN",
      types: hasEvidence("api.types") ? result.api.types : ["UNKNOWN"],
      rest: hasEvidence("api.rest") ? result.api.rest : "UNKNOWN",
      graphql: hasEvidence("api.graphql") ? result.api.graphql : "UNKNOWN",
      other: hasEvidence("api.other") ? result.api.other : "UNKNOWN",
      breadth: hasEvidence("api.breadth") ? result.api.breadth : "UNKNOWN",
      mcp: hasEvidence("api.mcp") && mcpHasRequiredEvidence ? result.api.mcp : "UNKNOWN",
    },
    buildability: {
      verdict: hasEvidence("buildability.verdict") ? result.buildability.verdict : "UNKNOWN",
      score: hasEvidence("buildability.score") ? result.buildability.score : "UNKNOWN",
      blocker: hasEvidence("buildability.blocker") ? result.buildability.blocker : "UNKNOWN",
      rationale: hasEvidence("buildability.rationale") ? result.buildability.rationale : "UNKNOWN",
    },
  };
}

/** Evaluates evidence coverage and source quality without mutating the research findings. */
export function assessEvidenceQuality(result: NormalizedResearchResult): EvidenceQualityAssessment {
  const materialFields = materialClaims(result);
  const evidenceByField = groupEvidenceByField(result.evidence);
  const missingFields = materialFields.filter((field) => !evidenceByField.has(field));
  const weaklySupportedFields = materialFields.filter((field) => {
    const evidence = evidenceByField.get(field) ?? [];
    return evidence.length > 0 && evidence.every((item) => sourceTypeRank[item.source_type] >= 6);
  });
  const conflictingFields = materialFields.filter((field) => {
    const evidence = evidenceByField.get(field) ?? [];
    return new Set(evidence.map((item) => normalizeClaim(item.claim))).size > 1;
  });
  const pricingOrAccessUnclear = [
    result.credential_access.model,
    result.credential_access.free,
    result.credential_access.trial,
    result.credential_access.paid_plan,
    result.credential_access.admin_approval,
    result.credential_access.partner_required,
    result.credential_access.contact_sales,
  ].includes("UNKNOWN");
  const mcpUnclear = result.api.mcp === "UNKNOWN";

  return {
    missing_fields: missingFields,
    weakly_supported_fields: weaklySupportedFields,
    conflicting_fields: conflictingFields,
    pricing_or_access_unclear: pricingOrAccessUnclear,
    mcp_unclear: mcpUnclear,
    should_mark_low_confidence:
      missingFields.length > 0 ||
      weaklySupportedFields.length > 0 ||
      conflictingFields.length > 0 ||
      pricingOrAccessUnclear ||
      mcpUnclear,
  };
}

/** Returns true if any research field remains unknown and merits a fallback pass. */
export function hasUnknownFindings(result: NormalizedResearchResult): boolean {
  return materialClaims(result).length < allResearchClaimPaths.length;
}

function visit(
  value: unknown,
  origin: CollectedSource["origin"],
  sources: CollectedSource[],
  seenObjects: WeakSet<object>,
  maxSources: number,
): void {
  if (sources.length >= maxSources || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, origin, sources, seenObjects, maxSources);
      if (sources.length >= maxSources) {
        return;
      }
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (seenObjects.has(value)) {
    return;
  }
  seenObjects.add(value);

  const record = value as Record<string, unknown>;
  const url = firstString(record, urlKeys);
  if (url !== undefined && isUrl(url)) {
    sources.push({
      url,
      page_title: firstString(record, titleKeys) ?? "UNKNOWN",
      summary: firstString(record, summaryKeys) ?? "No summary returned by the research tool.",
      origin,
      retrieved_at: new Date().toISOString(),
    });
  }

  for (const child of Object.values(record)) {
    visit(child, origin, sources, seenObjects, maxSources);
    if (sources.length >= maxSources) {
      return;
    }
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isUrl(value: string): boolean {
  return z.string().url().safeParse(value).success;
}

function deduplicateCollectedSources(sources: readonly CollectedSource[]): CollectedSource[] {
  const unique = new Map<string, CollectedSource>();
  for (const source of sources) {
    const key = normalizeUrl(source.url);
    if (!unique.has(key)) {
      unique.set(key, source);
    }
  }
  return [...unique.values()];
}

function scoreSource(source: CollectedSource): number {
  const text = `${source.url} ${source.page_title}`.toLocaleLowerCase("en-US");
  return ["developer", "developers", "docs", "documentation", "api", "oauth"].reduce(
    (score, token) => score + (text.includes(token) ? 1 : 0),
    0,
  );
}

export function normalizeUrl(url: string): string {
  return new URL(url).toString();
}

const allResearchClaimPaths = [
  "app.description",
  "authentication.methods",
  "authentication.primary_method",
  "authentication.notes",
  "credential_access.model",
  "credential_access.free",
  "credential_access.trial",
  "credential_access.paid_plan",
  "credential_access.admin_approval",
  "credential_access.partner_required",
  "credential_access.contact_sales",
  "credential_access.notes",
  "api.documented",
  "api.types",
  "api.rest",
  "api.graphql",
  "api.other",
  "api.breadth",
  "api.mcp",
  "buildability.verdict",
  "buildability.score",
  "buildability.blocker",
  "buildability.rationale",
] as const;

function materialClaims(result: NormalizedResearchResult): Array<Evidence["normalized_field"]> {
  const claims: Array<Evidence["normalized_field"]> = [];
  const addIfKnown = (claim: Evidence["normalized_field"], value: unknown): void => {
    if (value !== "UNKNOWN") {
      claims.push(claim);
    }
  };

  addIfKnown("app.description", result.app.description);
  if (!isUnknownOnly(result.authentication.methods)) {
    claims.push("authentication.methods");
  }
  addIfKnown("authentication.primary_method", result.authentication.primary_method);
  addIfKnown("authentication.notes", result.authentication.notes);
  addIfKnown("credential_access.model", result.credential_access.model);
  addIfKnown("credential_access.free", result.credential_access.free);
  addIfKnown("credential_access.trial", result.credential_access.trial);
  addIfKnown("credential_access.paid_plan", result.credential_access.paid_plan);
  addIfKnown("credential_access.admin_approval", result.credential_access.admin_approval);
  addIfKnown("credential_access.partner_required", result.credential_access.partner_required);
  addIfKnown("credential_access.contact_sales", result.credential_access.contact_sales);
  addIfKnown("credential_access.notes", result.credential_access.notes);
  addIfKnown("api.documented", result.api.documented);
  if (!isUnknownOnly(result.api.types)) {
    claims.push("api.types");
  }
  addIfKnown("api.rest", result.api.rest);
  addIfKnown("api.graphql", result.api.graphql);
  addIfKnown("api.other", result.api.other);
  addIfKnown("api.breadth", result.api.breadth);
  addIfKnown("api.mcp", result.api.mcp);
  addIfKnown("buildability.verdict", result.buildability.verdict);
  addIfKnown("buildability.score", result.buildability.score);
  addIfKnown("buildability.blocker", result.buildability.blocker);
  addIfKnown("buildability.rationale", result.buildability.rationale);

  return claims;
}

function isUnknownOnly(values: readonly string[]): boolean {
  return values.length === 1 && values[0] === "UNKNOWN";
}

function groupEvidenceByField(evidence: readonly Evidence[]): Map<Evidence["normalized_field"], Evidence[]> {
  const grouped = new Map<Evidence["normalized_field"], Evidence[]>();
  for (const item of evidence) {
    const items = grouped.get(item.normalized_field) ?? [];
    items.push(item);
    grouped.set(item.normalized_field, items);
  }
  return grouped;
}

function normalizeClaim(claim: string): string {
  return claim.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function sourceSupportsAuthenticationMethod(
  source: CollectedSource,
  method: NormalizedResearchResult["authentication"]["primary_method"],
): boolean {
  const text = `${source.page_title} ${source.summary}`.toLocaleLowerCase("en-US");
  const patterns: Record<Exclude<NormalizedResearchResult["authentication"]["primary_method"], "UNKNOWN">, RegExp> = {
    oauth2: /\boauth(?:\s*2(?:\.0)?)?\b|\bopenid connect\b/,
    api_key: /\bapi[ _-]?key\b|\baccess token\b/,
    basic_auth: /\bbasic auth(?:entication)?\b/,
    bearer_token: /\bbearer token\b/,
    service_account: /\bservice account\b/,
    jwt: /\bjson web token\b|\bjwt\b/,
    custom: /\bcustom auth(?:entication)?\b/,
    none: /\bno auth(?:entication)?\b|\bwithout auth(?:entication)?\b|\bdoes not require auth(?:entication)?\b/,
  };
  return method !== "UNKNOWN" && patterns[method].test(text);
}

function assertAuthenticationEvidence(
  result: NormalizedResearchResult,
  sourceByUrl: ReadonlyMap<string, CollectedSource>,
): void {
  for (const method of result.authentication.methods) {
    if (
      method !== "UNKNOWN" &&
      !hasDirectAuthenticationEvidence(result.evidence, sourceByUrl, "authentication.methods", method)
    ) {
      throw new Error(`Missing direct evidence for authentication.methods: ${method}`);
    }
  }
  if (
    result.authentication.primary_method !== "UNKNOWN" &&
    !hasDirectAuthenticationEvidence(
      result.evidence,
      sourceByUrl,
      "authentication.primary_method",
      result.authentication.primary_method,
    )
  ) {
    throw new Error(
      `Missing direct evidence for authentication.primary_method: ${result.authentication.primary_method}`,
    );
  }
}

function hasDirectAuthenticationEvidence(
  evidence: readonly Evidence[],
  sourceByUrl: ReadonlyMap<string, CollectedSource>,
  field: "authentication.methods" | "authentication.primary_method",
  method: NormalizedResearchResult["authentication"]["primary_method"],
): boolean {
  return evidence.some((item) => {
    if (item.normalized_field !== field) {
      return false;
    }
    const source = sourceByUrl.get(normalizeUrl(item.source_url));
    return source !== undefined && sourceSupportsAuthenticationMethod(source, method);
  });
}
