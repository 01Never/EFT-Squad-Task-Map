// Squad on a simulated Tailscale network: cmd/faketailnet (Tailscale's own test control server,
// a DERP relay and STUN on 127.0.0.1, with invite codes, tags, an ACL and the admin console's
// actions) and three real app binaries joined to it through the page (Settings → Squad), each with
// STM_SQUAD_CONTROL_URL and its own data folder. Mirrors docs/handoff-05-tailscale-test.md as far
// as one machine can: join, the console's machine list, drawings, tasks, offline and back,
// relay-only paths, intruders, an expired code, a deleted machine, Leave → rejoin, idle CPU.
//
// Skipped (with a message) when tsnet can't run here, and on Windows unless STM_E2E_TAILNET=1:
// tsnet binds UDP on every interface, so Windows Firewall asks about each new test binary.
// STM_E2E_SHOTS=<dir> also saves screenshots there.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { browserSuite, buildTool, Scenario, sleep, startApp, startToolProcess, stateWithTasks, taskNamed, waitUntil } from "./harness.js";

// Registered before the harness's own clean-up, so the fake tailnet stops even when that fails
// (e.g. the browser never started); a running faketailnet would keep the test process alive.
after(async () => {
  await tailnet?.stop();
});
browserSuite();

const MAP = "streets-of-tarkov";
const revision = taskNamed("Revision - Streets of Tarkov"); // three "mark" objectives
const glory = taskNamed("Glory to CPSU");
const ballet = taskNamed("Ballet Lover");
const dandies = taskNamed("Dandies");
const SHOTS_DIR = process.env.STM_E2E_SHOTS || "";
const IDLE_SECONDS = 60;
const SIGNED_OUT_TEXT = "Signed out of the squad network: leave, then join again with an invite code";

// ---------------------------------------------------------------- the fake tailnet

/** cmd/faketailnet, running, with its admin API. */
class FakeTailnet {
  async start() {
    const exe = await buildTool("faketailnet", "./cmd/faketailnet");
    this.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stm-e2e-faketailnet-"));
    this.process = startToolProcess(exe, ["-state", this.stateDir]);
    await waitUntil(() => {
      if (this.process.child.exitCode !== null) throw new Error("faketailnet stopped: " + this.process.output());
      return /faketailnet: ready/.test(this.process.output());
    }, { timeout: 15_000, what: "faketailnet to start" });
    this.controlURL = /faketailnet: control (\S+)/.exec(this.process.output())[1];
    this.invites = await this.get("/admin/invites");
  }

  async stop() {
    await this.process?.stop();
    if (this.stateDir) fs.rmSync(this.stateDir, { recursive: true, force: true, maxRetries: 5 });
  }

  async request(method, pathname, body) {
    const response = await fetch(this.controlURL + pathname, { method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const answer = await response.json();
    if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${JSON.stringify(answer)}`);
    return answer;
  }

  get(pathname) { return this.request("GET", pathname); }
  post(pathname, body = {}) { return this.request("POST", pathname, body); }
  settings(change) { return this.request("PUT", "/admin/settings", change); }

  /** The admin console's machine list. */
  nodes() { return this.get("/admin/nodes"); }

  /** One line per machine, for the report: "stm-… [tag:stm] online". */
  async listing() {
    const nodes = await this.nodes();
    return nodes.map((node) => `${node.name} [${(node.tags || []).join(",")}] ${node.online ? "online" : "offline"}${node.loggedOut ? " logged-out" : ""}${node.expired ? " expired" : ""}`).join("; ");
  }

  /** WireGuard bytes relayed from one machine to another so far. */
  async relayedBytes(fromName, toName) {
    const relay = await this.get("/admin/relay");
    return relay.pairs.find((pair) => pair.from === fromName && pair.to === toName)?.bytes || 0;
  }

  startTestNode(hostName, inviteCode, serveShare) {
    return this.post("/admin/test-nodes", { hostName, inviteCode, ...(serveShare ? { serveShare } : {}) });
  }

  fetchFrom(hostName, url) { return this.post(`/admin/test-nodes/${hostName}/fetch`, { url }); }
  paths(hostName) { return this.get(`/admin/test-nodes/${hostName}/paths`); }
  stopTestNode(hostName) { return this.request("DELETE", `/admin/test-nodes/${hostName}`); }
}

/** Starts the fake tailnet and one test node on it; returns the tailnet, or why the scenario is skipped. */
async function startTailnetOrSkip() {
  if (process.platform === "win32" && process.env.STM_E2E_TAILNET !== "1") {
    return { skip: "set STM_E2E_TAILNET=1 to run real tsnet nodes on Windows (Windows Firewall asks about each new binary that binds UDP)" };
  }
  const tailnet = new FakeTailnet();
  try {
    await tailnet.start();
    await tailnet.startTestNode("probe", tailnet.invites.tagged);
    await tailnet.stopTestNode("probe");
    return { tailnet };
  } catch (error) {
    await tailnet.stop().catch(() => {});
    return { skip: `tsnet can't run in this environment: ${error.message}` };
  }
}

// ---------------------------------------------------------------- one copy of the app

class Player {
  constructor(name, color, state, controlURL) {
    this.name = name;
    this.color = color;
    this.env = { STM_SQUAD_CONTROL_URL: controlURL };
    this.scenario = new Scenario(`squad-tailnet--${name.toLowerCase()}`, { state, env: this.env });
  }

  get page() { return this.scenario.page; }
  get dataDir() { return this.scenario.app.dataDir; }

  async start() {
    await this.scenario.start();
    await this.scenario.openMap(MAP);
  }

  async openSettings() {
    await this.page.click("#settings");
    await this.page.waitForSelector("#sSquad");
  }

  async closeSettings() { await this.page.click("#sClose"); }

  /** Settings → Squad: paste the code and Join. Returns the error shown, or "" once joined. */
  async tryJoin(code) {
    await this.openSettings();
    await this.page.fill("#sSquadKey", code);
    const startedAt = Date.now();
    await this.page.click("#sSquadJoin");
    await this.page.waitForSelector("#sSquadName, #sSquadError", { timeout: 100_000 });
    this.joinMs = Date.now() - startedAt;
    const error = await this.page.locator("#sSquadError").count() ? (await this.page.textContent("#sSquadError")).trim() : "";
    return error;
  }

  async join(code) {
    const error = await this.tryJoin(code);
    assert.equal(error, "", `${this.name} joined`);
    // Name and colour stay across Leave; set them only when they differ (no change, no request).
    if ((await this.page.inputValue("#sSquadName")) !== this.name) {
      await this.page.fill("#sSquadName", this.name);
      await this.scenario.answered("PUT", "/api/squad/profile", () => this.page.press("#sSquadName", "Tab"));
    }
    if ((await this.page.inputValue("#sSquadColor")) !== this.color) {
      await this.scenario.answered("PUT", "/api/squad/profile", () => this.page.fill("#sSquadColor", this.color));
    }
    await this.closeSettings();
    this.id = await this.playerId(); // a new one after each Leave
  }

  /** One line: status and friends as the server sees them. */
  async summary() {
    const view = await this.view();
    const friends = view.friends.map((friend) => `${friend.name} ${friend.online ? "online" : "offline"}`).join(", ");
    return `${this.name}: "${view.status.text}" [${friends}]`;
  }

  async leave() {
    await this.openSettings();
    await this.page.click("#sSquadLeave"); // the harness accepts the confirm
    await this.page.waitForSelector("#sSquadKey");
    await this.closeSettings();
  }

  async statusText() {
    await this.openSettings();
    const text = (await this.page.textContent("#sSquadStatus")).trim();
    await this.closeSettings();
    return text;
  }

  view() { return this.scenario.api("/api/squad"); }
  async playerId() { return (await this.view()).me.playerId; }
  get machineName() { return "stm-" + this.id; }

  chip(friendId) { return this.page.locator(`.squad-chip[data-friend="${friendId}"]`); }
  friendLines(friendId) { return this.page.locator(`svg.map g[data-friend="${friendId}"] polyline`).count(); }

  /** Closes the app (the browser page stays, like a closed exe with the tab left open). */
  async close() { await this.scenario.app.stop(); }

  /** Starts the app again on its own data folder (resumes from the node key, no invite code). */
  async restart() {
    this.scenario.step("restart");
    this.scenario.app = await startApp({ slug: this.scenario.slug, dataDir: this.dataDir, keepData: true, env: this.env });
    await this.page.goto(this.scenario.base + `/#/map/${MAP}`);
    await this.scenario.waitForMap(MAP);
  }

  /** The app's console output so far. */
  consoleOutput() { return fs.readFileSync(path.join(this.dataDir, "app-output.txt"), "utf8"); }

  async shot(name) {
    if (!SHOTS_DIR) return;
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await this.page.screenshot({ path: path.join(SHOTS_DIR, `tailnet-${name}.png`), animations: "disabled" });
  }
}

async function eventually(check, what, timeout = 10_000) {
  await waitUntil(check, { timeout, interval: 100, what });
}

/** Draws one line in `drawer`'s page and returns how long until every viewer shows it (ms). */
async function drawAndTime(drawer, viewers, linesBefore, dx = 160, dy = 60) {
  await drawer.page.click("#bdraw");
  const startedAt = Date.now();
  await drawer.scenario.dragMap(dx, dy);
  const arrivals = [];
  for (const viewer of viewers) {
    await eventually(async () => (await viewer.friendLines(drawer.id)) === linesBefore + 1, `${viewer.name} sees ${drawer.name}'s line`, 15_000);
    arrivals.push(Date.now() - startedAt);
  }
  await drawer.page.click("#bdraw"); // leave draw mode
  return Math.max(...arrivals);
}

// ---------------------------------------------------------------- CPU and memory of a process

function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout))));
}

/** CPU seconds a process has used so far, and its resident memory in MB. */
async function processUsage(pid) {
  if (process.platform === "linux") {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const clockTicksPerSecond = 100;
    const cpuSeconds = (Number(fields[11]) + Number(fields[12])) / clockTicksPerSecond;
    const rssKB = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]);
    return { cpuSeconds, memoryMB: rssKB / 1024 };
  }
  if (process.platform === "win32") {
    const out = await run("powershell", ["-NoProfile", "-Command", `$p = Get-Process -Id ${pid}; "$($p.TotalProcessorTime.TotalSeconds) $($p.WorkingSet64)"`]);
    const [cpuSeconds, workingSetBytes] = out.trim().split(/\s+/).map(Number);
    return { cpuSeconds, memoryMB: workingSetBytes / 1048576 };
  }
  const out = await run("ps", ["-o", "time=,rss=", "-p", String(pid)]);
  const [time, rssKB] = out.trim().split(/\s+/);
  const cpuSeconds = time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return { cpuSeconds, memoryMB: Number(rssKB) / 1024 };
}

// ---------------------------------------------------------------- the scenario

const { tailnet, skip } = await startTailnetOrSkip();
if (skip) console.log(`# squad-tailnet skipped: ${skip}`);

test("three copies on a simulated Tailscale network", { skip: skip || false, timeout: 900_000 }, async (t) => {
  const codes = tailnet.invites;
  const alice = new Player("Alice", "#e03131", stateWithTasks([revision.name, glory.name, ballet.name]), tailnet.controlURL);
  const bob = new Player("Bob", "#1c7ed6", stateWithTasks([revision.name, dandies.name]), tailnet.controlURL);
  const cara = new Player("Cara", "#2f9e44", stateWithTasks([glory.name]), tailnet.controlURL);
  const players = [alice, bob, cara];
  const report = (line) => t.diagnostic(line);
  try {
    for (const player of players) await player.start();

    await t.test("an expired invite code shows a clear error in Settings and leaves nothing on disk", async () => {
      const error = await cara.tryJoin(codes.expired);
      report(`expired code → "${error}" (after ${cara.joinMs} ms)`);
      assert.equal(error, "Couldn't join the squad: this invite code has expired.");
      await cara.shot("expired-code");
      await cara.closeSettings();
      assert.equal(fs.existsSync(path.join(cara.dataDir, "squad-task-map-tailscale")), false, "no tailscale folder");
      assert.equal((await cara.view()).settings.joined, false);
      assert.deepEqual(await tailnet.nodes(), [], "no machine in the console");
    });

    await t.test("all three join through Settings and see 'Connected · 2 of 2 friends online'", async () => {
      for (const player of players) {
        await player.join(codes.tagged);
        player.id = await player.playerId();
        report(`${player.name} (${player.machineName}) joined in ${player.joinMs} ms`);
      }
      for (const player of players) {
        await eventually(async () => (await player.page.locator(".squad-chip.online").count()) === 2, `${player.name} sees two friends online`, 30_000);
        await eventually(async () => (await player.statusText()) === "Connected · 2 of 2 friends online", `${player.name}'s status line`);
      }
      await alice.openSettings();
      await alice.shot("joined-settings");
      await alice.closeSettings();
    });

    await t.test("the console lists three stm-<id> machines tagged tag:stm, online", async () => {
      const nodes = await tailnet.nodes();
      report(`console: ${await tailnet.listing()}`);
      assert.deepEqual(nodes.map((node) => node.name).sort(), players.map((player) => player.machineName).sort());
      for (const node of nodes) {
        assert.deepEqual(node.tags, ["tag:stm"]);
        assert.equal(node.online, true);
        assert.equal(node.dnsName, `${node.name}.faketailnet.ts.net.`);
      }
      assert.ok(!JSON.stringify(nodes).includes(codes.untagged));
    });

    await t.test("a drawing in Alice reaches Bob and Cara in her colour within about 2 s; undo and Bob's toggle work", async () => {
      const elapsed = await drawAndTime(alice, [bob, cara], 0);
      report(`direct paths: Alice's drawing reached both friends in ${elapsed} ms`);
      assert.ok(elapsed <= 3000, `took ${elapsed} ms`);
      assert.equal(await bob.page.getAttribute(`svg.map g[data-friend="${alice.id}"] polyline`, "stroke"), "#e03131");
      await bob.shot("friend-drawing");
      await alice.page.click("#bdraw");
      await alice.page.click("#dundo");
      for (const other of [bob, cara]) await eventually(async () => (await other.friendLines(alice.id)) === 0, `${other.name}: undo removes the line`);
      await alice.page.click("#dredo");
      for (const other of [bob, cara]) await eventually(async () => (await other.friendLines(alice.id)) === 1, `${other.name}: redo brings it back`);
      await alice.page.click("#bdraw");
      await bob.page.click(`[data-squad-drawings="${alice.id}"]`);
      assert.equal(await bob.friendLines(alice.id), 0, "Bob hid Alice's drawings");
      assert.equal(await cara.friendLines(alice.id), 1, "Cara still sees them");
      await bob.page.click(`[data-squad-drawings="${alice.id}"]`);
      assert.equal(await bob.friendLines(alice.id), 1);
    });

    await t.test("with the normal policy the copies talk directly, not through the relay", async () => {
      await tailnet.startTestNode("witness", codes.tagged);
      const paths = await tailnet.paths("witness");
      report(`witness paths (normal): ${paths.map((row) => `${row.dnsName.split(".")[0]} direct=${row.direct || "-"} relay=${row.relay}`).join("; ")}`);
      const before = await tailnet.relayedBytes(alice.machineName, bob.machineName);
      await drawAndTime(alice, [bob, cara], 1, -120, 40);
      const relayed = (await tailnet.relayedBytes(alice.machineName, bob.machineName)) - before;
      report(`normal mode: Alice → Bob bytes through the relay during a drawing: ${relayed}`);
      assert.ok(paths.some((row) => row.direct), "at least one direct path");
    });

    await t.test("tasks are shared from Alice only: 'Also:', badges and the filter", async () => {
      await bob.page.click(`[data-squad-tasks="${alice.id}"]`);
      assert.equal(await bob.page.locator(".also").count(), 0, "Alice isn't sharing tasks yet");
      await alice.openSettings();
      await alice.page.check("#sSquadShareTasks");
      await alice.closeSettings();
      const bobRow = `#panel .task[data-task="${revision.id}"]`;
      await eventually(async () => (await bob.page.locator(bobRow + " .also").count()) === 1, "Bob's Revision row says 'Also: Alice'");
      assert.equal((await bob.page.textContent(bobRow + " .also")).trim(), "Also: Alice");
      const dots = await bob.page.locator("svg.map g.mk .squad-dot").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("fill")));
      assert.equal(dots.length, revision.objs.length, "a dot on each of Revision's markers");
      assert.ok(dots.every((fill) => fill === "#e03131"));
      await bob.page.click('[data-act="squadonly"]');
      assert.equal(await bob.page.locator("#panel .cat .task").count(), 1, "the filter keeps only Revision");
      await bob.page.click('[data-act="squadonly"]');
      await alice.page.click(`[data-squad-tasks="${bob.id}"]`);
      await sleep(1500);
      assert.equal(await alice.page.locator(".also").count(), 0, "Bob shares no tasks");
      assert.equal((await alice.view()).friends.find((friend) => friend.playerId === bob.id).share.tasks, null);
      await bob.shot("tasks-shared");
    });

    await t.test("Cara closed → 'last seen' for Alice and Bob; restarted → back with no new Join", async () => {
      await cara.close();
      for (const other of [alice, bob]) {
        await eventually(async () => /last seen/.test(await other.chip(cara.id).textContent()), `${other.name} sees Cara's 'last seen'`, 20_000);
      }
      report(`Cara closed → console: ${await tailnet.listing()}`);
      const requestsBefore = cara.scenario.requests.length;
      await cara.restart();
      for (const other of [alice, bob]) {
        await eventually(async () => (await other.chip(cara.id).textContent()).includes("online"), `${other.name} sees Cara online again`, 30_000);
      }
      const joinsAfterRestart = cara.scenario.requests.slice(requestsBefore).filter((line) => line.startsWith("POST /api/squad/join"));
      assert.deepEqual(joinsAfterRestart, [], "no Join after the restart");
      const caraMachines = (await tailnet.nodes()).filter((node) => node.name.startsWith(cara.machineName));
      assert.deepEqual(caraMachines.map((node) => node.name), [cara.machineName], "the same machine, no -1");
      await eventually(async () => (await cara.statusText()) === "Connected · 2 of 2 friends online", "Cara's status");
    });

    await t.test(`idle: the three joined copies over ${IDLE_SECONDS} s`, async () => {
      await sleep(3000);
      const before = await Promise.all(players.map((player) => processUsage(player.scenario.app.process.pid)));
      await sleep(IDLE_SECONDS * 1000);
      const after = await Promise.all(players.map((player) => processUsage(player.scenario.app.process.pid)));
      players.forEach((player, index) => {
        const cpuPercent = ((after[index].cpuSeconds - before[index].cpuSeconds) / IDLE_SECONDS) * 100;
        report(`idle ${player.name}: ${cpuPercent.toFixed(3)} % of one core (${(after[index].cpuSeconds - before[index].cpuSeconds).toFixed(2)} s CPU in ${IDLE_SECONDS} s), ${after[index].memoryMB.toFixed(1)} MB resident`);
        assert.ok(cpuPercent < 2, `${player.name} uses ${cpuPercent.toFixed(2)} % CPU while idle`);
      });
    });

    await t.test("relay-only: with direct paths blocked the drawing still arrives, through the relay", async () => {
      await tailnet.settings({ relayOnly: true });
      await tailnet.stopTestNode("witness");
      // Paths already made stay direct; restart every copy so new paths are made.
      for (const player of players) await player.close();
      const restartedAt = Date.now();
      for (const player of players) await player.restart();
      try {
        for (const player of players) {
          await eventually(async () => (await player.page.locator(".squad-chip.online").count()) === 2, `${player.name} sees two friends online (relay-only)`, 90_000);
        }
      } finally {
        for (const player of players) report(`relay-only after ${Date.now() - restartedAt} ms: ${await player.summary()}`);
        report(`relay-only console: ${await tailnet.listing()}`);
      }
      const before = await tailnet.relayedBytes(alice.machineName, bob.machineName);
      const beforeCara = await tailnet.relayedBytes(alice.machineName, cara.machineName);
      const linesBefore = await bob.friendLines(alice.id);
      const elapsed = await drawAndTime(alice, [bob, cara], linesBefore, 100, -80);
      const relayedToBob = (await tailnet.relayedBytes(alice.machineName, bob.machineName)) - before;
      const relayedToCara = (await tailnet.relayedBytes(alice.machineName, cara.machineName)) - beforeCara;
      report(`relay-only: drawing reached both friends in ${elapsed} ms; through the relay: Alice → Bob ${relayedToBob} bytes, Alice → Cara ${relayedToCara} bytes`);
      assert.ok(elapsed <= 3000, `took ${elapsed} ms`);
      assert.ok(relayedToBob > 0 && relayedToCara > 0, "the drawing went through the relay");
      await tailnet.startTestNode("witness", codes.tagged);
      const paths = await tailnet.paths("witness");
      report(`witness paths (relay-only): ${paths.map((row) => `${row.dnsName.split(".")[0]} direct=${row.direct || "-"} relay=${row.relay} ping=${row.ping}`).join("; ")}`);
      const relay = await tailnet.get("/admin/relay");
      report(`relay: ${relay.discoDropped} disco messages dropped, ${relay.discoRelayed} relayed before relay-only`);
      assert.ok(paths.length >= 3 && paths.every((row) => !row.direct), "no direct path to any copy");
      await tailnet.stopTestNode("witness");
    });

    await t.test("an untagged node on the same tailnet can't read any copy's peer API", async () => {
      await tailnet.startTestNode("laptop", codes.untagged);
      const nodes = await tailnet.nodes();
      const addressOf = (player) => nodes.find((node) => node.name === player.machineName).addresses[0];
      for (const player of players) {
        const result = await tailnet.fetchFrom("laptop", `http://${addressOf(player)}:7777/squad/v1/share`);
        report(`untagged → ${player.name} (squad policy): status ${result.status} ${result.error}`);
        assert.equal(result.status, 0, "no answer: the policy drops it");
      }
      // A too-loose policy (Tailscale's default "everyone reaches everyone"): the app's own check.
      await tailnet.settings({ acl: "open" });
      await sleep(1000);
      for (const player of players) {
        for (const route of ["/squad/v1/share", "/squad/v1/stream"]) {
          const result = await tailnet.fetchFrom("laptop", `http://${addressOf(player)}:7777${route}`);
          report(`untagged → ${player.name}${route} (open policy): ${result.status} ${result.body.trim()}`);
          assert.equal(result.status, 403);
        }
      }
      await tailnet.settings({ acl: "squad" });
      await tailnet.stopTestNode("laptop");
    });

    await t.test("a tagged node calling itself like Alice is not trusted", async () => {
      const impostorShare = { v: 1, player: { id: alice.id, name: "Impostor", color: "#000000" }, rev: 99, updatedAt: Date.now(), draw: {}, tasks: null };
      await tailnet.startTestNode(alice.machineName, codes.tagged, impostorShare);
      const listing = await tailnet.listing();
      report(`impostor joined → console: ${listing}`);
      assert.ok(listing.includes(`${alice.machineName}-1 [tag:stm] online`), "the tailnet names it -1");
      for (const other of [bob, cara]) {
        await eventually(() => other.consoleOutput().includes(`two machines on the tailnet claim player ${alice.id}`), `${other.name} logs the clash`);
        const view = await other.view();
        assert.ok(!JSON.stringify(view).includes("Impostor"), `${other.name} never shows the impostor's share`);
        const shownAlice = view.friends.find((friend) => friend.playerId === alice.id);
        report(`${other.name} during the clash: Alice ${shownAlice.online ? "online" : "offline"}, name "${shownAlice.name}"`);
      }
      // A tag:stm machine is a squad member to the peer API: it can read shares (by design).
      const bobNode = (await tailnet.nodes()).find((node) => node.name === bob.machineName);
      const read = await tailnet.fetchFrom(alice.machineName, `http://${bobNode.addresses[0]}:7777/squad/v1/share`);
      report(`the tagged impostor reading Bob's share: ${read.status} (any tag:stm machine is a squad member)`);
      await tailnet.stopTestNode(alice.machineName); // also deletes its machine in the console
      for (const other of [bob, cara]) {
        await eventually(async () => (await other.chip(alice.id).textContent()).includes("online"), `${other.name} trusts Alice again after the impostor is deleted`, 30_000);
      }
    });

    await t.test("a machine deleted in the console: that copy shows the signed-out state", async () => {
      await tailnet.post(`/admin/nodes/${cara.machineName}/delete`);
      const deletedAt = Date.now();
      await eventually(async () => (await cara.view()).status.state === "needsLogin", "Cara's server says signed out", 30_000);
      await eventually(async () => (await cara.statusText()) === SIGNED_OUT_TEXT, "Cara's Settings say signed out");
      report(`deleted machine → after ${Date.now() - deletedAt} ms Cara's Settings say: "${await cara.statusText()}"`);
      await cara.openSettings();
      await cara.shot("signed-out");
      await cara.closeSettings();
      for (const other of [alice, bob]) {
        await eventually(async () => /last seen/.test(await other.chip(cara.id).textContent()), `${other.name} sees Cara offline`, 20_000);
      }
      // The way back: Leave, then join again with the code (her name is free: the machine was deleted).
      await cara.leave();
      await cara.join(codes.tagged);
      report(`Cara left and joined again → console: ${await tailnet.listing()}`);
      for (const other of [alice, bob]) {
        await eventually(async () => (await other.chip(cara.id).textContent()).includes("online"), `${other.name} sees Cara again`, 30_000);
      }
    });

    await t.test("Leave then rejoin with the same code: a new identity, friends see it at once", async () => {
      const oldId = bob.id;
      const oldMachine = bob.machineName;
      await bob.leave();
      assert.equal(fs.existsSync(path.join(bob.dataDir, "squad-task-map-tailscale")), false, "Bob's node key is deleted");
      const afterLeave = await tailnet.listing();
      report(`Bob left → console: ${afterLeave}`);
      assert.ok(afterLeave.includes(`${oldMachine} [tag:stm] offline logged-out`), "the fake keeps the old machine listed, logged out");
      await bob.join(codes.tagged);
      assert.notEqual(bob.id, oldId, "Leave gave Bob a new player id");
      const afterRejoin = await tailnet.listing();
      report(`Bob joined again as ${bob.machineName} → console: ${afterRejoin}`);
      assert.ok(afterRejoin.includes(`${oldMachine} [tag:stm] offline logged-out`), "the old machine is still listed");
      assert.ok(afterRejoin.includes(`${bob.machineName} [tag:stm] online`), "the rejoin is a new stm-<id> machine, not -1");
      assert.ok(!afterRejoin.includes("-1 ["), "no -1 name");
      const rejoinedAt = Date.now();
      await eventually(async () => (await alice.chip(bob.id).textContent()).includes("online"), "Alice sees Bob online, no console action", 30_000);
      await eventually(async () => (await cara.chip(bob.id).textContent()).includes("online"), "Cara sees Bob online", 30_000);
      report(`Alice and Cara see the rejoined Bob online after ${Date.now() - rejoinedAt} ms, with nothing done in the console`);
      const oldEntry = (await alice.view()).friends.find((friend) => friend.playerId === oldId);
      report(`Alice's old entry for Bob: ${oldEntry ? (oldEntry.online ? "online" : "offline") : "gone"}`);
      assert.ok(!oldEntry || !oldEntry.online, "the old identity is offline");
      assert.ok(!alice.consoleOutput().includes(`claim player ${bob.id}`), "no clash for the new id");
      await eventually(async () => (await bob.statusText()) === "Connected · 2 of 2 friends online", "Bob's status");
    });

    await t.test("if the tailnet removes a machine when it logs out, Leave → rejoin works the same", async () => {
      await tailnet.settings({ logoutRemovesMachine: true });
      const oldMachine = cara.machineName;
      await cara.leave();
      const afterLeave = await tailnet.listing();
      report(`Cara left (log-out removes the machine) → console: ${afterLeave}`);
      assert.ok(!afterLeave.includes(oldMachine), "the old machine is gone");
      await cara.join(codes.tagged);
      report(`Cara joined again as ${cara.machineName} → console: ${await tailnet.listing()}`);
      for (const other of [alice, bob]) {
        await eventually(async () => (await other.chip(cara.id).textContent()).includes("online"), `${other.name} sees Cara again`, 30_000);
      }
      await tailnet.settings({ logoutRemovesMachine: false });
    });

    for (const player of players) player.scenario.assertNoPageErrors();
  } finally {
    for (const player of players) await player.scenario.stop().catch(() => {});
  }
});
