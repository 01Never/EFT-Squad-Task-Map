// Browser smoke suite: everything the scenario files share.
//
// - Builds the app and the offline mock from THIS working tree (so the suite always tests the page
//   files next to it), runs the mock, and starts one app per scenario with scratch folders under
//   the system temp folder. Never the owner's real data.
// - Drives headless Edge with playwright-core.
// - Imports nothing from web/js (those paths move in ticket 04b). The suite only relies on what a
//   user or the server sees: DOM ids, classes, data-* attributes, visible text and the HTTP API.
//   README.md lists every selector it uses.
// - Record mode (STM_E2E_RECORD=<dir>) saves screenshots, each scenario's API requests and the
//   saved-data round trips, for compare.mjs.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { after } from "node:test";
import { chromium } from "playwright-core";

// ---------------------------------------------------------------- settings

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES_DIR = path.join(REPO_ROOT, "tests", "browser", "fixtures");
const EXPECTED_DIR = path.join(FIXTURES_DIR, "expected");

/** Ports: the mock on 7821, the apps on 7830–7859 (another copy of the suite may use 7822 / 7860+). */
export const MOCK_PORT = Number(process.env.STM_E2E_MOCK_PORT || 7821);
const APP_PORTS = portRange(process.env.STM_E2E_APP_PORTS || "7830-7859");
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;

const EDGE_PATH = process.env.STM_E2E_EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const GO = process.env.STM_E2E_GO || "go";

/** Where record mode writes (screenshots, request lists, saved-data round trips); null = not recording. */
export const RECORD_DIR = process.env.STM_E2E_RECORD ? path.resolve(process.env.STM_E2E_RECORD) : null;
/** STM_E2E_UPDATE=1 rewrites the recorded expectations in fixtures/expected/ instead of checking them. */
const UPDATE_EXPECTED = process.env.STM_E2E_UPDATE === "1";
/** STM_E2E_KEEP=1 leaves the scratch folders in place, for debugging. */
const KEEP_SCRATCH = process.env.STM_E2E_KEEP === "1";
/** STM_E2E_PAGE_FROM_DISK=1 serves web/ from disk (STM_ASSETS_DIR) instead of the files built into the exe. */
const PAGE_FROM_DISK = process.env.STM_E2E_PAGE_FROM_DISK === "1";

/** The only key the mock's fake OpenAI accepts. */
export const OPENAI_TEST_KEY = "sk-test_1234567890abcdefghijkl";
/** The MS2000 marker's item id: what a "mark" objective uses up when ticked. */
export const MS2000_MARKER_ID = "5991b51486f77447b112d44f";

export const DESKTOP_VIEWPORT = { width: 1600, height: 900 };
export const PHONE_VIEWPORT = { width: 400, height: 850 };

const LOG_SESSION_FOLDER = "log_2026.10.05_10-00-00_1.1.5.1";
const APPLICATION_LOG = "x application_000.log";
const NOTIFICATIONS_LOG = "x push-notifications_000.log";
// Real log lines look like this (testdata/logs/real-session).
const LOG_LINE_START = "2026-10-05 11:25:03.123|1.1.5.1.47510|Info|";

/** A real 1×1 PNG, so the page's createImageBitmap works on "screenshots" dropped for a scan. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Facing about 45°, as Tarkov writes it in a GPS screenshot's name. */
export const FACING_45_DEGREES = "0.00000, 0.38268, 0.00000, 0.92388";
export const FACING_135_DEGREES = "0.00000, 0.92388, 0.00000, 0.38268";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portRange(text) {
  const [first, last] = text.split("-").map(Number);
  const ports = [];
  for (let port = first; port <= (last || first); port++) ports.push(port);
  return ports;
}

// ---------------------------------------------------------------- game data and saved-state fixtures

let goldenGameData = null;
/** The game data the mock serves (JSON-equal to the app's /api/data once it has downloaded it). */
export function gameData() {
  if (!goldenGameData) {
    const file = path.join(REPO_ROOT, "testdata", "golden", "data-mock.json.gz");
    goldenGameData = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8"));
  }
  return goldenGameData;
}

/** A task from the game data, by its exact name. */
export function taskNamed(name) {
  const task = gameData().tasks.find((candidate) => candidate.name === name);
  if (!task) throw new Error(`No task called "${name}" in the game data`);
  return task;
}

/** A task's name from its id (the id itself when the game data doesn't have it). */
export function taskNameOf(id) {
  return gameData().tasks.find((task) => task.id === id)?.name ?? id;
}

export function mapData(key) {
  const map = gameData().maps.find((candidate) => candidate.key === key);
  if (!map) throw new Error(`No map "${key}" in the game data`);
  return map;
}

/** The average position of a map's extracts: a spot that's always inside the map. */
export function middleOfExtracts(key) {
  const extracts = mapData(key).extracts;
  const sum = extracts.reduce((total, extract) => ({ x: total.x + extract.x, z: total.z + extract.z }), { x: 0, z: 0 });
  return { x: sum.x / extracts.length, z: sum.z / extracts.length };
}

/** A fixture from tests/browser/fixtures, parsed (a fresh copy each time). */
export function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

/** The v1 fixture: the owner's real v1 file. */
export function v1StateText() {
  return fs.readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "v1-data.json"), "utf8");
}

/** A task entry as the page writes it. */
export function taskEntry(extra = {}) {
  return { active: true, source: "manual", addedAt: 1790000000000, gamePct: null, scannedAt: null, noSplit: false, pinned: false, partCats: {}, ...extra };
}

/** The page's fresh state with these tasks active (by name), each entry adjustable. */
export function stateWithTasks(names, entryExtras = {}) {
  const state = readFixture("fresh-v2-state.json");
  for (const name of names) state.tasks[taskNamed(name).id] = taskEntry(entryExtras[name]);
  return state;
}

/** Every task in the game data active: the map is as busy as it gets. */
export function stateWithEveryTask() {
  const state = readFixture("fresh-v2-state.json");
  for (const task of gameData().tasks) state.tasks[task.id] = taskEntry({ addedAt: 1 });
  return state;
}

// ---------------------------------------------------------------- recorded expectations

/**
 * Checks a value against tests/browser/fixtures/expected/<name>.json, recorded from the page before
 * ticket 04b. With STM_E2E_UPDATE=1 the file is (re)written instead.
 */
export function assertMatchesRecorded(name, actual) {
  const file = path.join(EXPECTED_DIR, name + ".json");
  if (UPDATE_EXPECTED) {
    fs.mkdirSync(EXPECTED_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(`No recorded expectation ${path.relative(REPO_ROOT, file)}. Record it from a known-good page with STM_E2E_UPDATE=1.`);
  }
  assert.deepStrictEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")), `differs from the recorded expectation ${name}`);
}

/** Writes a file into the record folder (record mode only). */
export function writeRecording(relativePath, content) {
  if (!RECORD_DIR) return;
  const file = path.join(RECORD_DIR, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// ---------------------------------------------------------------- waiting

/** Polls `check` (sync or async) until it returns something truthy. */
export async function waitUntil(check, { timeout = 15_000, interval = 100, what = "a condition" } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  for (;;) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const description = typeof what === "function" ? what() : what;
      throw new Error(`Timed out after ${timeout} ms waiting for ${description}` + (lastError ? ` (last error: ${lastError.message})` : ""));
    }
    await sleep(interval);
  }
}

// ---------------------------------------------------------------- tools: the app and the mock, built from this tree

/**
 * Builds the app and the mock from this working tree, once per run. The global set-up
 * (global-setup.js) does it for the whole run and passes the folder on in STM_E2E_RUN_DIR; a file
 * run on its own builds its own copy.
 */
let toolsPromise = null;
export function prepareTools() {
  if (!toolsPromise) toolsPromise = buildTools();
  return toolsPromise;
}

async function buildTools() {
  const sharedRunDir = process.env.STM_E2E_RUN_DIR;
  const runDir = sharedRunDir || fs.mkdtempSync(path.join(os.tmpdir(), "stm-e2e-run-"));
  const binDir = path.join(runDir, "bin");
  const tools = { runDir, ownsRunDir: !sharedRunDir, appExe: path.join(binDir, "stm-e2e.exe"), mockExe: path.join(binDir, "stm-e2e-mock.exe") };
  if (process.env.STM_E2E_TOOLS_READY === "1" && fs.existsSync(tools.appExe) && fs.existsSync(tools.mockExe)) return tools;
  fs.mkdirSync(binDir, { recursive: true });
  await goBuild(tools.appExe, ".");
  await goBuild(tools.mockExe, "./cmd/mock");
  return tools;
}

function goBuild(output, packagePath) {
  return new Promise((resolve, reject) => {
    execFile(GO, ["build", "-o", output, packagePath], { cwd: REPO_ROOT, env: environmentWithoutAppSettings(), windowsHide: true, maxBuffer: 16 << 20 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`go build ${packagePath} failed: ${stderr || error.message}`));
      else resolve();
    });
  });
}

/** The parent's environment minus every STM_* setting, so a developer's own (e.g. real data folder) never leaks in. */
function environmentWithoutAppSettings() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) if (!/^STM_|^MOCK_|^PORT$/i.test(name)) environment[name] = value;
  return environment;
}

const childProcesses = new Set();
process.on("exit", () => {
  for (const child of childProcesses) {
    try { child.kill(); } catch { /* already gone */ }
  }
});

/** Starts the offline mock on MOCK_PORT (or reuses one already answering there). Returns a stop function. */
export async function startMock(tools) {
  if (await mockIsAnswering()) return { stop: async () => {}, reused: true };
  const child = spawn(tools.mockExe, [], {
    cwd: REPO_ROOT, // the mock reads testdata/ from here
    env: { ...environmentWithoutAppSettings(), MOCK_PORT: String(MOCK_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childProcesses.add(child);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`the mock stopped: ${output}`);
    return mockIsAnswering();
  }, { timeout: 15_000, what: `the mock on port ${MOCK_PORT}` });
  return { stop: () => stopProcess(child), reused: false };
}

async function mockIsAnswering() {
  try {
    const response = await fetch(MOCK_BASE + "/log", { signal: AbortSignal.timeout(1000) });
    return response.ok && Array.isArray(await response.json());
  } catch {
    return false;
  }
}

async function stopProcess(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  childProcesses.delete(child);
}

/** Makes sure this process has the tools and a mock (shared from the global set-up, or its own). */
let processSetupPromise = null;
function prepareProcess() {
  if (!processSetupPromise) {
    processSetupPromise = (async () => {
      const tools = await prepareTools();
      const mock = process.env.STM_E2E_MOCK_READY === "1" ? { stop: async () => {} } : await startMock(tools);
      return { tools, mock };
    })();
  }
  return processSetupPromise;
}

// ---------------------------------------------------------------- app ports (shared between test processes)

const PORT_LOCK_DIR = path.join(os.tmpdir(), "stm-e2e-ports");

/** Claims a free app port: a lock file per port, so parallel test files never pick the same one. */
async function claimPort() {
  fs.mkdirSync(PORT_LOCK_DIR, { recursive: true });
  const start = Math.floor(Math.random() * APP_PORTS.length);
  for (let attempt = 0; attempt < APP_PORTS.length * 3; attempt++) {
    const port = APP_PORTS[(start + attempt) % APP_PORTS.length];
    const lockFile = path.join(PORT_LOCK_DIR, `${port}.lock`);
    if (!takeLock(lockFile)) continue;
    if (await portIsFree(port)) return { port, release: () => fs.rmSync(lockFile, { force: true }) };
    fs.rmSync(lockFile, { force: true });
  }
  throw new Error(`No free app port in ${APP_PORTS[0]}–${APP_PORTS.at(-1)}`);
}

function takeLock(lockFile) {
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    // Held: by a live process, or left behind by one that died.
    const owner = Number(fs.readFileSync(lockFile, "utf8"));
    if (owner && owner !== process.pid && !processIsAlive(owner)) {
      fs.rmSync(lockFile, { force: true });
      return takeLock(lockFile);
    }
    return false;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

// ---------------------------------------------------------------- one app, with scratch folders

/**
 * Starts the app on scratch folders: data (state + settings), a game Logs folder with one session
 * and empty application / notifications logs, and a screenshots folder. Waits until the game data
 * has been downloaded from the mock, so no "data changed" event reaches the page mid-test.
 * @param {{ slug: string, state?: object | string, settings?: object, dataDir?: string }} options
 */
export async function startApp(options) {
  const { tools } = await prepareProcess();
  const dataDir = options.dataDir || path.join(tools.runDir, "data", options.slug);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const logsDir = path.join(dataDir, "logs");
  const sessionDir = path.join(logsDir, LOG_SESSION_FOLDER);
  const shotsDir = path.join(dataDir, "shots");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, APPLICATION_LOG), "");
  fs.writeFileSync(path.join(sessionDir, NOTIFICATIONS_LOG), "");
  const stateFile = path.join(dataDir, "squad-task-map-data.json");
  const settingsFile = path.join(dataDir, "squad-task-map-settings.json");
  if (options.state !== undefined) fs.writeFileSync(stateFile, typeof options.state === "string" ? options.state : JSON.stringify(options.state));
  fs.writeFileSync(settingsFile, JSON.stringify({ gameMode: "regular", ...(options.settings || {}) }));

  for (let attempt = 1; ; attempt++) {
    const { port, release } = await claimPort();
    const environment = {
      ...environmentWithoutAppSettings(),
      STM_DATA_DIR: dataDir, STM_LOGS_DIR: logsDir, STM_SCREENSHOTS_DIR: shotsDir, STM_NO_BROWSER: "1", PORT: String(port),
      STM_JSON_BASE: MOCK_BASE, STM_OPENAI_API: MOCK_BASE + "/v1", STM_WIKI_API: MOCK_BASE + "/wiki",
      ...(PAGE_FROM_DISK ? { STM_ASSETS_DIR: REPO_ROOT } : {}),
    };
    const outputFile = path.join(dataDir, "app-output.txt");
    const output = fs.openSync(outputFile, "w");
    const child = spawn(tools.appExe, [], { cwd: dataDir, env: environment, stdio: ["ignore", output, output], windowsHide: true });
    fs.closeSync(output);
    childProcesses.add(child);
    const base = `http://127.0.0.1:${port}`;
    const app = { base, port, dataDir, logsDir, sessionDir, shotsDir, stateFile, settingsFile, process: child, gpsCount: 0 };
    app.stop = async () => {
      await stopProcess(child);
      release();
    };
    try {
      await waitUntil(async () => {
        if (child.exitCode !== null) throw new Error(`the app stopped: ${fs.readFileSync(outputFile, "utf8")}`);
        const status = await (await fetch(base + "/api/status", { signal: AbortSignal.timeout(2000) })).json();
        if (path.resolve(status.statePath).toLowerCase() !== path.resolve(stateFile).toLowerCase()) throw new Error("another program answers on port " + port);
        return status.data.origin === "live";
      }, { timeout: 30_000, what: "the app to start and download the game data from the mock" });
      return app;
    } catch (error) {
      await app.stop();
      if (attempt >= 3) throw error;
    }
  }
}

// ---------------------------------------------------------------- the browser

let browserPromise = null;
function launchBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: [
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        "--font-render-hinting=none",
        // Item icons come from assets.tarkov.dev: no host name resolves, so every run looks the same
        // (the page removes icons that fail to load) and nothing leaves this PC.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ],
    });
  }
  return browserPromise;
}

/**
 * Call once at the top of each scenario file: closes the browser (and this process's own mock,
 * if it started one) when the file's tests are done.
 */
export function browserSuite() {
  after(async () => {
    if (browserPromise) await (await browserPromise).close().catch(() => {});
    if (processSetupPromise) {
      const { tools, mock } = await processSetupPromise;
      await mock.stop();
      if (tools.ownsRunDir && !KEEP_SCRATCH) fs.rmSync(tools.runDir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
}

// ---------------------------------------------------------------- requests: what record mode keeps

/** Static files: their order depends on module loading and 04b moves them, so they're a set, not a list. */
function isStaticFile(pathname) {
  return pathname === "/" || pathname === "/index.html" || /^\/(js|css|fonts)\//.test(pathname) || /\.(js|css|woff2?)$/.test(pathname);
}

/**
 * One line per request the page makes: "METHOD /path?query", plus a fingerprint of the body for
 * PUT/POST. Values that change from run to run are replaced first: timestamps from the last two
 * days, ids the page makes up at random (new categories and sub-tasks), AI job ids.
 */
function describeRequest(request, bodies) {
  const url = new URL(request.url());
  const target = (url.pathname + url.search).replace(/^\/api\/ai\/job\/[^/?]+/, "/api/ai/job/<job>");
  let line = `${request.method()} ${target}`;
  const body = request.postData();
  if (body) {
    const normalized = normalizeBody(body);
    const fingerprint = createHash("sha1").update(normalized).digest("hex").slice(0, 12);
    bodies[fingerprint] = normalized.length > 20_000 ? normalized.slice(0, 20_000) + "…" : normalized;
    line += ` body:${fingerprint}`;
  }
  return line;
}

const RECENT_MS = 2 * 24 * 3600 * 1000;
const RUNTIME_ID = /^c?[0-9a-z]{3,10}$/;
const STABLE_IDS = new Set(["unsorted"]);

function normalizeBody(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  const runtimeIds = [];
  const collect = (node, parentKey) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if ((parentKey === "cats" || parentKey === "subs") && item && typeof item.id === "string" && RUNTIME_ID.test(item.id) && !STABLE_IDS.has(item.id) && !runtimeIds.includes(item.id)) runtimeIds.push(item.id);
        collect(item, null);
      }
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) collect(child, key);
    }
  };
  collect(value, null);
  const now = Date.now();
  const replace = (node) => {
    if (typeof node === "string") {
      const index = runtimeIds.indexOf(node);
      if (index >= 0) return `<new id ${index + 1}>`;
      return node.startsWith("data:") && node.length > 200 ? `<data url, sha1 ${createHash("sha1").update(node).digest("hex").slice(0, 12)}>` : node;
    }
    if (typeof node === "number") return Math.abs(node - now) < RECENT_MS ? "<recent time>" : node;
    if (Array.isArray(node)) return node.map(replace);
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        const index = runtimeIds.indexOf(key);
        out[index >= 0 ? `<new id ${index + 1}>` : key] = replace(child);
      }
      return out;
    }
    return node;
  };
  return JSON.stringify(replace(value));
}

// ---------------------------------------------------------------- a scenario: one app + one browser page

function slugOf(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/**
 * Runs one scenario: starts an app with the given saved data and settings, opens a fresh browser
 * context, runs `body`, then checks the page logged no errors, records (in record mode) and cleans
 * up, also when the scenario fails.
 * @param {import("node:test").TestContext} t
 * @param {{ state?: object | string, settings?: object, viewport?: {width:number,height:number}, phone?: boolean, dataDir?: string, recordAs?: string }} options
 * @param {(scenario: Scenario) => Promise<void>} body
 */
export async function withScenario(t, options, body) {
  const fileSlug = slugOf(path.basename(process.argv[1] || "suite").replace(/\.e2e\.mjs$/, ""));
  const scenario = new Scenario(options.recordAs || `${fileSlug}--${slugOf(t.name)}`, options);
  try {
    await scenario.start();
    await body(scenario);
    await scenario.settle();
    scenario.assertNoPageErrors();
    scenario.saveRequestList();
  } finally {
    await scenario.stop();
  }
}

export class Scenario {
  constructor(slug, options) {
    this.slug = slug;
    this.options = options;
    this.pageErrors = [];
    this.dialogs = [];
    this.requests = [];
    this.staticRequests = new Set();
    this.bodies = {};
    this.pending = new Set();
  }

  async start() {
    this.app = await startApp({ slug: this.slug, state: this.options.state, settings: this.options.settings, dataDir: this.options.dataDir });
    const browser = await launchBrowser();
    const phone = !!this.options.phone;
    this.context = await browser.newContext({
      viewport: this.options.viewport || (phone ? PHONE_VIEWPORT : DESKTOP_VIEWPORT),
      deviceScaleFactor: 1,
      isMobile: phone,
      hasTouch: phone,
      locale: "en-US",
      timezoneId: "UTC",
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15_000);
    this.listen(this.page);
  }

  listen(page) {
    page.on("pageerror", (error) => this.pageErrors.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The browser's own network log ("Failed to load resource: … 400", a blocked icon) isn't a
      // page error: the request lists cover requests.
      if (/^Failed to load resource:/.test(message.text())) return;
      this.pageErrors.push(`console error: ${message.text()} ${message.location()?.url || ""}`);
    });
    page.on("dialog", async (dialog) => {
      this.dialogs.push(dialog.message());
      await dialog.accept();
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== this.app.base) return;
      if (isStaticFile(url.pathname)) {
        this.staticRequests.add(`${request.method()} ${url.pathname}`);
      } else {
        const line = describeRequest(request, this.bodies);
        // The page asks for an AI job's progress once a second; how many times depends on timing.
        if (!(line.startsWith("GET /api/ai/job/") && this.requests.at(-1) === line)) this.requests.push(line);
      }
      if (url.pathname !== "/api/events") this.pending.add(request);
    });
    // Answered is enough: a save (keepalive) answered just before a reload never reports "finished".
    page.on("response", (response) => this.pending.delete(response.request()));
    page.on("requestfinished", (request) => this.pending.delete(request));
    page.on("requestfailed", (request) => this.pending.delete(request));
  }

  /** Marks a step in the recorded request list, so a difference is easy to place. */
  step(label) {
    this.requests.push(`# ${label}`);
  }

  async stop() {
    await this.context?.close().catch(() => {});
    await this.app?.stop();
    if (this.app && !KEEP_SCRATCH) fs.rmSync(this.app.dataDir, { recursive: true, force: true, maxRetries: 5 });
  }

  assertNoPageErrors() {
    assert.deepStrictEqual(this.pageErrors, [], "the page logged errors");
  }

  saveRequestList() {
    writeRecording(path.join("requests", this.slug + ".json"), JSON.stringify({ api: this.requests, static: [...this.staticRequests].sort(), bodies: this.bodies }, null, 2) + "\n");
  }

  /** Waits until the page has no request in flight (the live-event stream doesn't count). */
  async settle() {
    let quietSince = Date.now();
    await waitUntil(() => {
      if (this.pending.size) quietSince = Date.now();
      return Date.now() - quietSince >= 300;
    }, { timeout: 15_000, interval: 50, what: () => `the page's requests to finish (${[...this.pending].map((request) => request.method() + " " + request.url()).join(", ")})` });
  }

  // ------------------------------------------------ opening pages

  get base() {
    return this.app.base;
  }

  /** Loads the page on the map picker. */
  async openPicker() {
    await this.page.goto(this.base + "/#/");
    await this.waitForPicker();
  }

  async waitForPicker() {
    await this.page.waitForFunction(() => document.querySelector(".picker h1")?.textContent === "Maps" && document.querySelectorAll(".picker .card").length > 0);
  }

  /** Loads the page on a map. */
  async openMap(key) {
    await this.page.goto(`${this.base}/#/map/${key}`);
    await this.waitForMap(key);
  }

  /** Waits until a map page is drawn: map art, toolbar and task list. */
  async waitForMap(key) {
    await this.page.waitForFunction((mapKey) => location.hash === "#/map/" + mapKey && !!document.querySelector("svg.map") && !!document.querySelector("#bfindme") && !!document.querySelector("#panel .phead"), key);
    await this.page.evaluate(() => document.fonts.ready.then(() => true));
  }

  async reload() {
    await this.page.reload();
  }

  // ------------------------------------------------ actions that save

  /**
   * Runs `action` and waits for the page to save its data (PUT /api/state) once. Waiting for each
   * save keeps the number of saves the same from run to run (the page waits 500 ms before saving).
   */
  async saving(action, { timeout = 10_000 } = {}) {
    const saved = this.page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/state", { timeout });
    await action();
    const response = await saved;
    assert.ok(response.ok(), "saving the data failed");
  }

  /** Runs `action` and waits for one request to `pathname` to be answered. */
  async answered(method, pathname, action) {
    const done = this.page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === pathname, { timeout: 15_000 });
    await action();
    return done;
  }

  // ------------------------------------------------ the server and the saved files (read from Node, not the page)

  async api(pathname) {
    const response = await fetch(this.base + pathname);
    return response.json();
  }

  status() {
    return this.api("/api/status");
  }

  savedState() {
    return JSON.parse(fs.readFileSync(this.app.stateFile, "utf8"));
  }

  savedSettings() {
    return JSON.parse(fs.readFileSync(this.app.settingsFile, "utf8"));
  }

  screenshotFiles() {
    return fs.readdirSync(this.app.shotsDir).sort();
  }

  // ------------------------------------------------ the game: log lines and screenshots

  /** Appends a line to the application log, as the game does. */
  appLog(message) {
    fs.appendFileSync(path.join(this.app.sessionDir, APPLICATION_LOG), `${LOG_LINE_START}application|${message}\n`);
  }

  /** Appends a chat notification (task started / finished) to the notifications log. */
  notificationLog(notification) {
    fs.appendFileSync(path.join(this.app.sessionDir, NOTIFICATIONS_LOG), `${LOG_LINE_START}push-notifications|Got notification | ChatMessageReceived\n${JSON.stringify(notification, null, 2)}\n`);
  }

  /** A task started (10), failed (11) or finished (12) in-game. */
  taskMessage(taskId, type) {
    const suffix = type === 10 ? " description" : " successMessageText 5ac3b934156ae10c4430e83c 0";
    this.notificationLog({ type: "new_message", eventId: "x", message: { _id: "abc", type, templateId: taskId + suffix, text: "" } });
  }

  /** Drops a GPS-named screenshot (Tarkov writes the position and facing into the name). */
  dropGps(x, y, z, facing = FACING_45_DEGREES) {
    const number = this.app.gpsCount++;
    const name = `2026-10-05[14-${String(number % 60).padStart(2, "0")}]_${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}_${facing} (${number}).png`;
    fs.writeFileSync(path.join(this.app.shotsDir, name), "x");
    return name;
  }

  /** Drops an ordinary screenshot (no position in its name), e.g. a page of the task list. */
  dropScreenshot(name) {
    fs.writeFileSync(path.join(this.app.shotsDir, name), TINY_PNG);
  }

  /**
   * Drops a GPS screenshot and waits until the page has drawn the new position on the open map
   * (the player marker is re-created for each position).
   */
  async dropGpsAndWait(x, y, z, facing = FACING_45_DEGREES) {
    await this.page.evaluate(() => {
      for (const marker of document.querySelectorAll("svg.map g[data-r]")) marker.__stmOld = true;
    });
    this.dropGps(x, y, z, facing);
    await this.page.waitForFunction(() => {
      const marker = document.querySelector("svg.map g[data-r]");
      return marker && !marker.__stmOld;
    }, null, { timeout: 10_000 });
    await this.nextFrame();
  }

  // ------------------------------------------------ reading the page

  nextFrame() {
    return this.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  /** The map's view box (pan and zoom). */
  viewBox() {
    return this.page.evaluate(() => {
      const box = document.querySelector("svg.map").viewBox.baseVal;
      return { x: box.x, y: box.y, w: box.width, h: box.height };
    });
  }

  /** Map units per screen pixel: the zoom. */
  zoom() {
    return this.page.evaluate(() => {
      const svg = document.querySelector("svg.map");
      return svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
    });
  }

  /** Your marker's centre relative to the middle of the map area, in pixels (null when it isn't drawn). */
  playerOffset() {
    return this.page.evaluate(() => {
      const marker = document.querySelector("svg.map g[data-r]");
      const area = document.getElementById("findme-fx").getBoundingClientRect();
      if (!marker) return null;
      const box = marker.getBoundingClientRect();
      return { dx: box.left + box.width / 2 - (area.left + area.width / 2), dy: box.top + box.height / 2 - (area.top + area.height / 2) };
    });
  }

  /** The text of the toast, or "" when none is showing. */
  toastText() {
    return this.page.evaluate(() => {
      const toast = document.getElementById("toast");
      return toast && getComputedStyle(toast).display !== "none" ? toast.textContent.trim() : "";
    });
  }

  async waitForToast(textPart) {
    await this.page.waitForFunction((part) => {
      const toast = document.getElementById("toast");
      return toast && getComputedStyle(toast).display !== "none" && toast.textContent.includes(part);
    }, textPart);
    return this.toastText();
  }

  /** Waits until no toast is showing (toasts hide themselves after 3 or 7 s). */
  async waitForNoToast() {
    await this.page.waitForFunction(() => getComputedStyle(document.getElementById("toast")).display === "none", null, { timeout: 10_000 });
  }

  // ------------------------------------------------ using the map

  /** The middle of the map area, in page pixels. */
  async stageCentre() {
    const box = await this.page.locator("#stage").boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Drags the map by (dx, dy) pixels with the mouse; optionally keeps the button down. */
  async dragMap(dx, dy, { release = true } = {}) {
    const { x, y } = await this.stageCentre();
    const mouse = this.page.mouse;
    await mouse.move(x, y);
    await mouse.down();
    for (let i = 1; i <= 10; i++) await mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
    if (release) await mouse.up();
    await this.nextFrame();
  }

  /** The on-screen centre of an extract's diamond (null when it isn't drawn). */
  extractPoint(name) {
    return this.page.evaluate((extractName) => {
      const group = [...document.querySelectorAll("svg.map g.ex")].find((element) => element.dataset.name === extractName);
      if (!group) return null;
      const box = group.querySelector("rect").getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, name);
  }

  /** Clicks an extract on the map (after resetting the view so it's on screen). */
  async clickExtract(name) {
    await this.page.click("#zfit");
    await this.nextFrame();
    const point = await this.extractPoint(name);
    if (!point) throw new Error("extract not drawn: " + name);
    const hit = await this.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("g.ex")?.dataset.name ?? null, point);
    if (hit !== name) throw new Error(`extract ${name} is covered at its centre (hit: ${hit})`);
    await this.page.mouse.click(point.x, point.y);
  }

  /** A point on the map art with no marker, extract or map control on it. */
  emptyMapPoint() {
    return this.page.evaluate(() => {
      const stage = document.getElementById("stage").getBoundingClientRect();
      for (let fy = 0.3; fy <= 0.9; fy += 0.05) {
        for (let fx = 0.3; fx <= 0.9; fx += 0.05) {
          const x = stage.left + stage.width * fx, y = stage.top + stage.height * fy;
          const hit = document.elementFromPoint(x, y);
          const nearby = [[-20, 0], [20, 0], [0, -20], [0, 20]].some(([ox, oy]) => document.elementFromPoint(x + ox, y + oy)?.closest(".mk, .ex"));
          if (hit && hit.closest("svg.map") && !hit.closest(".mk, .ex") && !nearby) return { x, y };
        }
      }
      return null;
    });
  }

  // ------------------------------------------------ record mode

  /** Saves a screenshot to the record folder (record mode only). */
  async screenshot(name, { element, fullPage = false } = {}) {
    if (!RECORD_DIR) return;
    await this.page.evaluate(() => document.fonts.ready.then(() => true));
    await this.page.mouse.move(1, 1); // no hover effects
    await this.nextFrame();
    const file = path.join(RECORD_DIR, "screenshots", name + ".png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const options = { path: file, animations: "disabled", caret: "hide", scale: "css" };
    if (element) await this.page.locator(element).screenshot(options);
    else await this.page.screenshot({ ...options, fullPage });
  }
}

// ---------------------------------------------------------------- paint check (Chrome trace)

/**
 * Records a Chrome performance trace while `during` runs (a number = just wait that many ms) and
 * counts the rendering work on the page's main thread. The selection flash and the find-me pulse
 * are CSS transform/opacity animations that run on the compositor, so they must cause no Paint
 * or Layout there.
 */
export async function mainThreadRenderingWork(page, during) {
  const browser = page.context().browser();
  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] });
  const startedAt = Date.now();
  if (typeof during === "number") await sleep(during);
  else await during();
  const seconds = (Date.now() - startedAt) / 1000;
  const trace = JSON.parse((await browser.stopTracing()).toString("utf8"));
  const events = trace.traceEvents || trace;
  const mainThreads = new Set(events.filter((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain").map((event) => `${event.pid}:${event.tid}`));
  const count = (name) => events.filter((event) => event.name === name && event.ph !== "E" && mainThreads.has(`${event.pid}:${event.tid}`)).length;
  return { seconds, Paint: count("Paint"), Layout: count("Layout"), UpdateLayoutTree: count("UpdateLayoutTree"), PrePaint: count("PrePaint") };
}
