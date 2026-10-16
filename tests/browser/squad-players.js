// What the squad scenarios share (squad.e2e.mjs, squad-positions.e2e.mjs): a real copy of the app
// joined over the dev transport (Player), a fake friend that is only a peer API serving the share
// we give it (FakeFriend), and small waiting helpers. Not a scenario file itself (no .e2e.mjs).
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Scenario, waitUntil } from "./harness.js";

export const STREETS = "streets-of-tarkov";
export const SHOTS_DIR = process.env.STM_E2E_SHOTS || "";

/** A free TCP port on 127.0.0.1 (a peer API address for the dev transport). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {net.AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

/** Polls `check` every 100 ms until it is truthy (8 s by default). */
export async function eventually(check, what, timeout = 8000) {
  await waitUntil(check, { timeout, interval: 100, what });
}

/**
 * One friend: a scenario (app + browser page) joined to the squad over the dev transport.
 * `options.map` is the map its page opens at start (Streets by default); `options.exe` runs
 * another build of the app (e.g. an older release) instead of the one built from this tree.
 */
export class Player {
  constructor(name, color, peerPort, otherPeerPorts, state, options = {}) {
    this.name = name;
    this.color = color;
    this.map = options.map || STREETS;
    this.peerPort = peerPort;
    this.env = {
      STM_SQUAD_DEV_LISTEN: `127.0.0.1:${peerPort}`,
      STM_SQUAD_DEV_PEERS: otherPeerPorts.map((port) => `127.0.0.1:${port}`).join(","),
    };
    this.scenario = new Scenario(`squad--${name.toLowerCase()}`, { state, env: this.env, exe: options.exe });
  }

  get page() {
    return this.scenario.page;
  }

  async start() {
    await this.scenario.start();
    await this.scenario.openMap(this.map);
  }

  async openSettings() {
    await this.page.click("#settings");
    await this.page.waitForSelector("#sSquad");
  }

  async closeSettings() {
    await this.page.click("#sClose");
  }

  /** Settings → Squad: paste an invite code and Join, then set the name and colour. */
  async join() {
    await this.openSettings();
    await this.page.fill("#sSquadKey", "tskey-auth-dev-test");
    await this.page.click("#sSquadJoin");
    await this.page.waitForSelector("#sSquadName", { timeout: 30_000 });
    await this.setProfile();
    await this.closeSettings();
  }

  async setProfile() {
    await this.page.fill("#sSquadName", this.name);
    await this.answeredProfile(() => this.page.press("#sSquadName", "Tab"));
    await this.answeredProfile(() => this.page.fill("#sSquadColor", this.color));
  }

  answeredProfile(action) {
    return this.scenario.answered("PUT", "/api/squad/profile", action);
  }

  /** The player's id (from the server), to find its chip and toggles in the others' pages. */
  async playerId() {
    return (await this.scenario.api("/api/squad")).me.playerId;
  }

  /**
   * The share this copy's peer API gives friends right now (GET /squad/v1/share, as a friend on
   * this PC asks for it: no browser headers), or null when it has none.
   */
  peerShare() {
    return new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: this.peerPort, path: "/squad/v1/share" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve(response.statusCode === 200 ? JSON.parse(body) : null));
      }).on("error", reject);
    });
  }

  /** What this copy's server says about one friend (GET /api/squad), or undefined. */
  async friendView(friendId) {
    return (await this.scenario.api("/api/squad")).friends.find((friend) => friend.playerId === friendId);
  }

  chip(friendId) {
    return this.page.locator(`.squad-chip[data-friend="${friendId}"]`);
  }

  /** The number of lines of a friend on the map. */
  friendLines(friendId) {
    return this.page.locator(`svg.map g[data-friend="${friendId}"] polyline`).count();
  }

  async shot(name) {
    if (!SHOTS_DIR) return;
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await this.page.evaluate(() => document.fonts.ready.then(() => true));
    await this.page.screenshot({ path: path.join(SHOTS_DIR, name + ".png"), animations: "disabled" });
  }
}

/**
 * A friend that is only a peer API serving the share we give it, so its name, task ids and
 * position are ours. `publish(share)` sends a new one on every open stream, as a real copy does.
 */
export class FakeFriend {
  constructor(id, name, tasks, extra = {}) {
    this.share = { v: 1, player: { id, name, color: "#ff922b" }, rev: 1, updatedAt: 1000, draw: {}, tasks, ...extra };
    this.streams = new Set();
  }

  get id() {
    return this.share.player.id;
  }

  async start() {
    this.port = await freePort();
    this.server = http.createServer((req, res) => {
      if (req.url === "/squad/v1/share") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(this.share));
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": hi\n\nevent: share\ndata: " + JSON.stringify(this.share) + "\n\n");
      this.streams.add(res);
      res.on("close", () => this.streams.delete(res));
    });
    await new Promise((resolve) => this.server.listen(this.port, "127.0.0.1", resolve));
  }

  /** A new share (rev + 1) on every open stream. */
  publish(changes) {
    this.share = { ...this.share, ...changes, rev: this.share.rev + 1, updatedAt: Date.now() };
    for (const stream of this.streams) stream.write("event: share\ndata: " + JSON.stringify(this.share) + "\n\n");
  }

  stop() {
    this.server.close();
    this.server.closeAllConnections();
  }
}
