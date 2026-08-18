import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ZodType } from "zod";

/**
 * Minimal local persistence for pipeline artifacts. Each record is persisted as
 * one JSON line so future phases can retain immutable, append-oriented run data
 * without needing a service or database.
 */
export class JsonlStore<T> {
  public constructor(
    private readonly filePath: string,
    private readonly schema: ZodType<T>,
  ) {}

  public async append(record: T): Promise<void> {
    const existing = await this.read();
    await this.write([...existing, this.schema.parse(record)]);
  }

  public async read(): Promise<T[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => this.schema.parse(JSON.parse(line)));
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async write(records: readonly T[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const contents = records.map((record) => JSON.stringify(record)).join("\n");
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, contents.length > 0 ? `${contents}\n` : "", "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
