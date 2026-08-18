import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/config/environment.js";

describe("parseEnvironment", () => {
  it("uses safe local defaults without live credentials", () => {
    expect(parseEnvironment({})).toEqual({
      composioApiKey: undefined,
      concurrency: 3,
      dataDirectory: "data",
      outputDirectory: "output",
    });
  });
});
