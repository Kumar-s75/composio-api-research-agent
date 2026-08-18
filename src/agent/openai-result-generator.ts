import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  llmNormalizedResearchResultSchema,
  normalizedResearchResultSchema,
} from "../types/research-result.js";
import type { StructuredResearchResultGenerator } from "./research-agent.js";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

const openAiEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: optionalNonEmptyString,
    OPENAI_MODEL: z.preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      z.string().min(1).default("gpt-5.4-mini"),
    ),
  })
  .passthrough();

const responseTextSchema = z.object({ output_text: z.string().min(1) }).passthrough();

export interface OpenAiStructuredTextFormat {
  type: "json_schema";
  name: string;
  strict?: boolean | null;
  schema: Record<string, unknown>;
}

export interface OpenAiResponseClient {
  responses: {
    create(request: {
      model: string;
      input: string;
      text: { format: OpenAiStructuredTextFormat };
    }): Promise<unknown>;
  };
}

export interface OpenAiResultGeneratorOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAiResponseClient;
}

/**
 * Creates a provider-backed generator. The LLM receives only the collected
 * corpus and the evidence rules already encoded in the synthesis prompt.
 */
export function createOpenAiResultGenerator(
  options: OpenAiResultGeneratorOptions = {},
): StructuredResearchResultGenerator {
  const environment = openAiEnvironmentSchema.parse(process.env);
  const apiKey = options.apiKey ?? environment.OPENAI_API_KEY;
  const model = options.model ?? environment.OPENAI_MODEL;
  if (options.client === undefined && apiKey === undefined) {
    throw new Error("OPENAI_API_KEY is required for the OpenAI research result generator.");
  }
  const client = options.client;

  return {
    generate: async (input) => {
      const request = {
        model,
        input:
          `${input.prompt}\n\n` +
          "Return one JSON object only. Use UNKNOWN whenever the collected sources do not directly support a claim. " +
          "Do not cite any URL, title, timestamp, or excerpt that is not in the collected sources.",
        text: {
          format: zodTextFormat(
            llmNormalizedResearchResultSchema,
            "normalized_research_result",
          ),
        },
      };
      const response =
        client === undefined
          ? await new OpenAI({ apiKey }).responses.create(request)
          : await client.responses.create(request);
      const outputText = responseTextSchema.parse(response).output_text;
      const parsed = parseJsonObject(outputText);
      return normalizedResearchResultSchema.parse(parsed);
    },
  };
}

/** The CLI-importable implementation of StructuredResearchResultGenerator. */
export const resultGenerator: StructuredResearchResultGenerator = {
  generate: async (input) => createOpenAiResultGenerator().generate(input),
};

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `The OpenAI result generator returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
