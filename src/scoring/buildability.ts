import { z } from "zod";

import type { NormalizedResearchResult } from "../types/research-result.js";

export const deterministicBuildabilityVerdictSchema = z.enum([
  "EASY",
  "MODERATE",
  "DIFFICULT",
  "BLOCKED",
  "UNKNOWN",
]);

export const deterministicBuildabilityReasonSchema = z.enum([
  "documented_public_api",
  "self_serve_credentials",
  "free_or_trial_access",
  "standard_authentication",
  "moderate_api_surface",
  "broad_api_surface",
  "official_mcp_available",
  "community_mcp_available",
  "paid_only_access",
  "admin_approval_required",
  "partner_requirement",
  "contact_sales_required",
  "undocumented_or_private_api",
  "no_supported_authentication",
]);

export const deterministicBuildabilityBlockerSchema = z.enum([
  "none",
  "no_public_api",
  "credential_gated",
  "no_supported_auth",
  "restricted_api",
  "insufficient_docs",
  "legal_or_policy_restriction",
  "UNKNOWN",
]);

export const deterministicBuildabilityAssessmentSchema = z
  .object({
    score: z.union([z.number().int().min(0).max(10), z.literal("UNKNOWN")]),
    verdict: deterministicBuildabilityVerdictSchema,
    reasons: z.array(deterministicBuildabilityReasonSchema),
    blocker: deterministicBuildabilityBlockerSchema,
  })
  .strict();

export type DeterministicBuildabilityAssessment = z.infer<
  typeof deterministicBuildabilityAssessmentSchema
>;

/**
 * Converts evidence-backed normalized findings into a transparent 0–10 score.
 * This deliberately has no model dependency: the model can only supply the
 * factual inputs that have already passed the evidence validation boundary.
 */
export function scoreBuildability(
  research: NormalizedResearchResult,
): DeterministicBuildabilityAssessment {
  const reasons: DeterministicBuildabilityAssessment["reasons"] = [];

  if (research.api.documented === "UNKNOWN") {
    return {
      score: "UNKNOWN",
      verdict: "UNKNOWN",
      reasons,
      blocker: "insufficient_docs",
    };
  }

  if (research.api.documented === "no" || research.api.types.includes("none")) {
    return {
      score: 0,
      verdict: "BLOCKED",
      reasons: ["undocumented_or_private_api"],
      blocker: "no_public_api",
    };
  }

  let score = 3;
  reasons.push("documented_public_api");

  if (research.credential_access.model === "self_serve") {
    score += 2;
    reasons.push("self_serve_credentials");
  }
  if (research.credential_access.free === "yes" || research.credential_access.trial === "yes") {
    score += 1;
    reasons.push("free_or_trial_access");
  }
  if (hasStandardAuthentication(research)) {
    score += 1;
    reasons.push("standard_authentication");
  } else if (research.authentication.methods.includes("none")) {
    reasons.push("no_supported_authentication");
  }

  if (research.api.breadth === "platform" || research.api.breadth === "broad") {
    score += 2;
    reasons.push("broad_api_surface");
  } else if (research.api.breadth === "moderate") {
    score += 1;
    reasons.push("moderate_api_surface");
  }

  if (research.api.mcp === "official") {
    score += 1;
    reasons.push("official_mcp_available");
  } else if (research.api.mcp === "community") {
    reasons.push("community_mcp_available");
  }

  const paidOnly =
    research.credential_access.paid_plan === "yes" &&
    research.credential_access.free === "no" &&
    research.credential_access.trial === "no";
  if (paidOnly) {
    score -= 2;
    reasons.push("paid_only_access");
  }
  if (research.credential_access.admin_approval === "yes") {
    score -= 2;
    reasons.push("admin_approval_required");
  }
  if (research.credential_access.partner_required === "yes") {
    score -= 3;
    reasons.push("partner_requirement");
  }
  if (research.credential_access.contact_sales === "yes") {
    score -= 2;
    reasons.push("contact_sales_required");
  }

  const boundedScore = Math.max(0, Math.min(10, score));
  const blocker = selectBlocker(research, paidOnly);
  const verdict =
    blocker === "no_public_api"
      ? "BLOCKED"
      : boundedScore >= 7
        ? "EASY"
        : boundedScore >= 4
          ? "MODERATE"
          : "DIFFICULT";

  return { score: boundedScore, verdict, reasons, blocker };
}

function hasStandardAuthentication(research: NormalizedResearchResult): boolean {
  return research.authentication.methods.some((method) =>
    ["oauth2", "api_key", "bearer_token", "basic_auth", "service_account", "jwt"].includes(method),
  );
}

function selectBlocker(
  research: NormalizedResearchResult,
  paidOnly: boolean,
): DeterministicBuildabilityAssessment["blocker"] {
  if (research.credential_access.partner_required === "yes") {
    return "credential_gated";
  }
  if (research.credential_access.contact_sales === "yes") {
    return "credential_gated";
  }
  if (research.credential_access.admin_approval === "yes") {
    return "credential_gated";
  }
  if (paidOnly) {
    return "credential_gated";
  }
  if (research.authentication.methods.includes("none")) {
    return "no_supported_auth";
  }
  return "none";
}
