import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { appInputDatasetSchema } from "../src/types/apps.js";

async function readAssignmentApps(): Promise<unknown> {
  return JSON.parse(await readFile("data/apps.json", "utf8"));
}

describe("assignment app dataset", () => {
  it("contains exactly 100 unique apps with the original contiguous numbering", async () => {
    const apps = appInputDatasetSchema.parse(await readAssignmentApps());

    expect(apps).toHaveLength(100);
    expect(new Set(apps.map((app) => app.name.toLocaleLowerCase("en-US"))).size).toBe(100);
    expect(apps.map((app) => app.number)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  });
});
