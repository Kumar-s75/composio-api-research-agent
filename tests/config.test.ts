import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/config/environment.js";

describe("parseEnvironment", () => {
  it("uses safe local defaults without live credentials", () => {
    expect(parseEnvironment({})).toEqual({
      composioApiKey: undefined,
      concurrency: 3,
      dataDirectory: "data",
      outputDirectory: "output",
      researchRunId: undefined,
      researchMaxRetries: 2,
      researchResultGeneratorModule: undefined,
    });
  });

  it("treats blank optional .env values as absent", () => {
    expect(
      parseEnvironment({
        COMPOSIO_API_KEY: "",
        RESEARCH_RUN_ID: "",
        RESEARCH_RESULT_GENERATOR_MODULE: "",
      }),
    ).toMatchObject({
      composioApiKey: undefined,
      researchRunId: undefined,
      researchResultGeneratorModule: undefined,
    });
  });
});
