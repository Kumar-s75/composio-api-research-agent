import { describe, expect, it, vi } from "vitest";

import {
  initializeComposioFromEnvironment,
  loadComposioConfig,
  type ComposioResearchClient,
} from "../src/config/composio.js";
import {
  createResearchSession,
  discoverResearchTools,
  getResearchSessionTools,
  researchSessionConfig,
} from "../src/research/composio-tools.js";

describe("Composio configuration", () => {
  it("does not initialize a client when credentials are absent", () => {
    const clientFactory = vi.fn();

    expect(loadComposioConfig({})).toBeUndefined();
    expect(initializeComposioFromEnvironment({}, clientFactory)).toBeUndefined();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("creates and exposes a mockable research session without live credentials", async () => {
    const session = {
      sessionId: "session_research_123",
      execute: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue({ tools: [] }),
    };
    const client: ComposioResearchClient = {
      sessions: {
        create: vi.fn().mockResolvedValue(session),
      },
      tools: {
        getRawToolRouterSessionTools: vi.fn().mockResolvedValue([]),
      },
    };

    const createdSession = await createResearchSession(client, { userId: "research-run-001" });
    await getResearchSessionTools(client, createdSession);
    await discoverResearchTools(createdSession, "web research and URL fetching");

    expect(client.sessions.create).toHaveBeenCalledWith("research-run-001", researchSessionConfig);
    expect(client.tools.getRawToolRouterSessionTools).toHaveBeenCalledWith("session_research_123");
    expect(session.search).toHaveBeenCalledWith({
      query: "web research and URL fetching",
      toolkits: ["composio_search", "browser_tool"],
    });
  });
});
