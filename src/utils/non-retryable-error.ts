/** Marks a deterministic configuration or capability failure that retrying cannot resolve. */
export class NonRetryableError extends Error {
  public readonly nonRetryable = true;

  public constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function isNonRetryableError(error: unknown): error is NonRetryableError {
  return (
    typeof error === "object" &&
    error !== null &&
    "nonRetryable" in error &&
    error.nonRetryable === true
  );
}
