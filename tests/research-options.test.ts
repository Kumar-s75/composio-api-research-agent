import { describe, expect, it } from "vitest";

import { parseResearchCliOptions } from "../src/cli/research-options.js";

describe("parseResearchCliOptions", () => {
  it("accepts an explicit comma-separated selection", () => {
    expect(parseResearchCliOptions(["all", "--apps", "github, HubSpot,shopify"])).toEqual({
      command: "all",
      selectors: ["github", "HubSpot", "shopify"],
    });
  });

  it("preserves all-app and single-app commands", () => {
    expect(parseResearchCliOptions(["all"])).toEqual({ command: "all" });
    expect(parseResearchCliOptions(["single", "github"])).toEqual({
      command: "single",
      singleAppId: "github",
    });
  });

  it("rejects malformed explicit selections", () => {
    expect(() => parseResearchCliOptions(["all", "--apps", ",,,"])).toThrow("at least one");
    expect(() => parseResearchCliOptions(["resume", "--apps", "github"])).toThrow("cannot be combined");
  });
});
