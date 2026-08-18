import "dotenv/config";

import { z } from "zod";

const environmentSchema = z.object({
  COMPOSIO_API_KEY: z.string().min(1).optional(),
  CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  DATA_DIR: z.string().min(1).default("data"),
  OUTPUT_DIR: z.string().min(1).default("output"),
});

export interface ProjectConfig {
  composioApiKey: string | undefined;
  concurrency: number;
  dataDirectory: string;
  outputDirectory: string;
}

export function parseEnvironment(input: NodeJS.ProcessEnv): ProjectConfig {
  const environment = environmentSchema.parse(input);

  return {
    composioApiKey: environment.COMPOSIO_API_KEY,
    concurrency: environment.CONCURRENCY,
    dataDirectory: environment.DATA_DIR,
    outputDirectory: environment.OUTPUT_DIR,
  };
}

export function loadConfig(): ProjectConfig {
  return parseEnvironment(process.env);
}
