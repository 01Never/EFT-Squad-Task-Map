// Runs once for the whole browser suite (node --test --test-global-setup=…): builds the app and
// the mock from this working tree and starts the mock, so the scenario files (separate processes)
// share them. The values reach the files through environment variables.
import fs from "node:fs";
import { prepareTools, startMock } from "./harness.js";

let mock = null;
let runDir = null;

export async function globalSetup() {
  const tools = await prepareTools();
  runDir = tools.runDir;
  mock = await startMock(tools);
  process.env.STM_E2E_RUN_DIR = tools.runDir;
  process.env.STM_E2E_TOOLS_READY = "1";
  process.env.STM_E2E_MOCK_READY = "1";
}

export async function globalTeardown() {
  await mock?.stop();
  if (runDir && process.env.STM_E2E_KEEP !== "1") fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5 });
}
