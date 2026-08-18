import "dotenv/config";

import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  COMPOSIO_API_KEY: optionalNonEmptyString,
  CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  DATA_DIR: z.string().min(1).default("data"),
  OUTPUT_DIR: z.string().min(1).default("output"),
  RESEARCH_RUN_ID: optionalNonEmptyString,
  RESEARCH_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  RESEARCH_RESULT_GENERATOR_MODULE: optionalNonEmptyString,
});

export interface ProjectConfig {
  composioApiKey: string | undefined;
  concurrency: number;
  dataDirectory: string;
  outputDirectory: string;
  researchRunId: string | undefined;
  researchMaxRetries: number;
  researchResultGeneratorModule: string | undefined;
}

export function parseEnvironment(input: NodeJS.ProcessEnv): ProjectConfig {
  const environment = environmentSchema.parse(input);

  return {
    composioApiKey: environment.COMPOSIO_API_KEY,
    concurrency: environment.CONCURRENCY,
    dataDirectory: environment.DATA_DIR,
    outputDirectory: environment.OUTPUT_DIR,
    researchRunId: environment.RESEARCH_RUN_ID,
    researchMaxRetries: environment.RESEARCH_MAX_RETRIES,
    researchResultGeneratorModule: environment.RESEARCH_RESULT_GENERATOR_MODULE,
  };
}

export function loadConfig(): ProjectConfig {
  return parseEnvironment(process.env);
}
