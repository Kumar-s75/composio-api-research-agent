export type ResearchCommand = "all" | "single" | "resume";

export interface ResearchCliOptions {
  command: ResearchCommand;
  singleAppId?: string;
  selectors?: string[];
}

/** Parses the small CLI surface without starting a research run. */
export function parseResearchCliOptions(argv: readonly string[]): ResearchCliOptions {
  const [commandArgument, ...remaining] = argv;
  const command = commandArgument ?? "all";
  if (command !== "all" && command !== "single" && command !== "resume") {
    throw new Error("Usage: research [all|single <app-id>|resume] [--apps <id-or-name,...>]");
  }

  if (command === "single") {
    const appId = remaining[0];
    if (appId === undefined || appId.startsWith("--") || appId.trim().length === 0) {
      throw new Error("Usage: npm run research:single -- <app-id>");
    }
    if (remaining.length !== 1) {
      throw new Error("research:single accepts exactly one app ID and cannot be combined with --apps.");
    }
    return { command, singleAppId: appId.trim() };
  }

  if (remaining.length === 0) {
    return { command };
  }
  if (remaining.length !== 2 || remaining[0] !== "--apps") {
    throw new Error("Usage: research [all|resume] --apps <id-or-name,...>");
  }
  if (command === "resume") {
    throw new Error("research:resume resumes its persisted run and cannot be combined with --apps.");
  }

  const selectorArgument = remaining[1];
  if (selectorArgument === undefined) {
    throw new Error("--apps must contain at least one comma-separated app ID or app name.");
  }
  const selectors = selectorArgument
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (selectors.length === 0) {
    throw new Error("--apps must contain at least one comma-separated app ID or app name.");
  }
  return { command, selectors };
}
