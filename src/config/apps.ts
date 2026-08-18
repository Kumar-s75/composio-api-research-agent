import { readFile } from "node:fs/promises";

import { appInputDatasetSchema } from "../types/apps.js";
import type { AppInputDataset } from "../types/apps.js";

export async function loadAppInputDataset(filePath = "data/apps.json"): Promise<AppInputDataset> {
  const contents = await readFile(filePath, "utf8");
  return appInputDatasetSchema.parse(JSON.parse(contents));
}
