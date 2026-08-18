import pLimit from "p-limit";

export function createConcurrencyLimit(concurrency: number) {
  return pLimit(concurrency);
}
