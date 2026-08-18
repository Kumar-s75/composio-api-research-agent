import "dotenv/config";

import {
  Composio,
  type ToolList,
  type ToolRouterCreateSessionConfig,
  type ToolRouterSessionSearchResponse,
} from "@composio/core";
import { z } from "zod";

const composioApiKeySchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(1).optional(),
);

export const composioEnvironmentSchema = z
  .object({
    COMPOSIO_API_KEY: composioApiKeySchema,
  })
  .passthrough();

export interface ComposioIntegrationConfig {
  apiKey: string;
}

/**
 * The narrow SDK surface used by the research integration. Keeping this
 * structural interface separate from the concrete SDK makes the adapter easy
 * to test without network calls or Composio credentials.
 */
export interface ComposioResearchSession {
  readonly sessionId: string;
  execute(
    toolSlug: string,
    arguments_?: Record<string, unknown>,
  ): Promise<unknown>;
  search(
    params: { query: string; toolkits?: string[] },
  ): Promise<ToolRouterSessionSearchResponse>;
}

export interface ComposioResearchClient {
  sessions: {
    create(
      userId: string,
      config: ToolRouterCreateSessionConfig,
    ): Promise<ComposioResearchSession>;
  };
  tools: {
    getRawToolRouterSessionTools(sessionId: string): Promise<ToolList>;
  };
}

export type ComposioClientFactory = (
  config: ComposioIntegrationConfig,
) => ComposioResearchClient;

/** Returns undefined when no key is configured; importing this module never creates a client. */
export function loadComposioConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ComposioIntegrationConfig | undefined {
  const { COMPOSIO_API_KEY: apiKey } = composioEnvironmentSchema.parse(environment);
  return apiKey === undefined ? undefined : { apiKey };
}

/** Creates a current @composio/core client only after configuration is available. */
export function createComposioClient(
  config: ComposioIntegrationConfig,
): ComposioResearchClient {
  return new Composio({
    apiKey: config.apiKey,
    host: "composio-100-app-research",
  });
}

/**
 * Initializes the SDK only when a non-empty key is present. Tests can inject
 * a factory, avoiding both live credentials and SDK construction.
 */
export function initializeComposioFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  clientFactory: ComposioClientFactory = createComposioClient,
): ComposioResearchClient | undefined {
  const config = loadComposioConfig(environment);
  return config === undefined ? undefined : clientFactory(config);
}
