import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogWatcher } from "../server/logs.ts";
import { Screens } from "../server/screens.ts";
import { splitEntries, eventsFrom } from "../server/logparse.ts";

const ts = (s = 3) => `2026-10-01 11:25:0${s}.123 -05:00`;
export const notif = (type: number, taskId: string) =>
  `${ts()}|1.1.5.1|Info|notifications|Got notification | ChatMessageReceived\n{\n  "type": "new_message",\n  "eventId": "x",\n  "message": {\n    "_id": "abc",\n    "type": ${type},\n    "templateId": "${taskId} description",\n    "text": ""\n  }\n}\n`;
export const app = (msg: string) => `${ts()}|1.1.5.1|Info|application|${msg}\n`;

describe("log parsing", () => {
  test("task events with JSON blocks", () => {
    const { entries, rest } = splitEntries(notif(10, "5967530a86f77462ba22226b") + notif(12, "5967530a86f77462ba22226c"));
    expect(rest).toBe("");
    const evs = entries.flatMap(eventsFrom);
    expect(evs).toEqual([
      { type: "task", id: "5967530a86f77462ba22226b", status: "started", at: "2026-10-01T11:25:03.123" },
      { type: "task", id: "5967530a86f77462ba22226c", status: "finished", at: "2026-10-01T11:25:03.123" },
    ]);
  });
  test("an entry cut in the middle of its JSON waits for the rest", () => {
    const full = notif(11, "5967530a86f77462ba22226b");
    const cut = full.indexOf('"type": 11');
    const a = splitEntries(full.slice(0, cut));
    expect(a.entries.length).toBe(0);
    const b = splitEntries(a.rest + full.slice(cut));
    expect(b.entries.flatMap(eventsFrom)[0]).toMatchObject({ type: "task", status: "failed" });
  });
  test("raid lifecycle, session mode, keybind", () => {
    const text = app("Session mode: PvpSeason") + app("scene preset path:maps/city_preset.bundle rcid:x") + app("GameStarted:12.3 real:4.5") +
      app("SelectProfile ProfileId:5f1 AccountId:123") + app("Network game matching cancelled") +
      `${ts()}|1.1.5.1|Info|application|Control settings:\n{\n"keyBindings": [{"keyName": "MakeScreenshot", "variants": [{"keyCode": []}]}]\n}\n`;
    const evs = splitEntries(text).entries.flatMap(eventsFrom).map((e: any) => e.type + (e.mode ? ":" + e.mode : "") + (e.scene ? ":" + e.scene : "") + (e.ok === false ? ":unbound" : ""));
    expect(evs).toEqual(["mode:pvp-season", "mapLoading:maps/city_preset.bundle", "raidStart", "profileSelected", "matchingAborted", "keybind:unbound"]);
  });
});

describe("log watcher (files)", () => {
  test("starts at the end, reads new bytes, follows a new session folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "stm-logs-"));
    const s1 = join(dir, "log_2026.10.01_10-00-00_1.1.5.1");
    mkdirSync(s1);
    writeFileSync(join(s1, "2026.10.01_10-00-00_1.1.5.1 notifications.log"), notif(12, "aaaaaaaaaaaaaaaaaaaaaaaa")); // old: must be ignored
    writeFileSync(join(s1, "2026.10.01_10-00-00_1.1.5.1 application.log"), "");
    const got: any[] = [];
    const w = new LogWatcher((e) => got.push(e));
    w.start(dir);
    w.poll();
    expect(got.length).toBe(0); // no catch-up
    appendFileSync(join(s1, "2026.10.01_10-00-00_1.1.5.1 notifications.log"), notif(10, "bbbbbbbbbbbbbbbbbbbbbbbb"));
    w.poll();
    expect(got.map((e) => e.id)).toEqual(["bbbbbbbbbbbbbbbbbbbbbbbb"]);
    // game restarts → new session folder, read from its start
    const s2 = join(dir, "log_2026.10.01_12-00-00_1.1.5.1");
    mkdirSync(s2);
    writeFileSync(join(s2, "2026.10.01_12-00-00_1.1.5.1 application.log"), app("GameStarted:1 real:1"));
    for (let i = 0; i < 6; i++) w.poll(); // folder rescan happens every 6th poll (30 s)
    expect(got.some((e) => e.type === "raidStart")).toBe(true);
    w.stop();
  });
});

describe("screenshots watcher", () => {
  test("GPS shots, capture mode, and safe deletion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stm-shots-"));
    writeFileSync(join(dir, "old.png"), "x");
    const gps: any[] = [], caps: any[] = [];
    const s = new Screens({ gps: (f) => gps.push(f), capture: (c) => caps.push(c) });
    s.start(dir);
    const gpsName = "2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png";
    writeFileSync(join(dir, gpsName), "png");
    s.startCapture();
    await Bun.sleep(50);
    writeFileSync(join(dir, "2026-10-01[14-06]_1 (0).png"), "png");
    await Bun.sleep(900);
    expect(gps.length).toBe(1);
    expect(gps[0].x).toBeCloseTo(-120.53);
    expect(s.captureList().map((f) => f.name)).toEqual(["2026-10-01[14-06]_1 (0).png"]);
    expect(s.readCaptured("old.png")).toBe(null); // only files from this capture are served
    expect(s.deleteCaptured(["2026-10-01[14-06]_1 (0).png", "old.png"])).toBe(1);
    expect(s.deleteRaidShots()).toBe(1);
    expect(readdirSync(dir)).toEqual(["old.png"]);
    s.stop();
  });
});
void existsSync;
