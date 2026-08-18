import { loadConfig } from "./config/environment.js";

const config = loadConfig();

console.info("Project skeleton initialized", {
  dataDirectory: config.dataDirectory,
  outputDirectory: config.outputDirectory,
  concurrency: config.concurrency,
  composioConfigured: config.composioApiKey !== undefined,
});
