// Stand-in for json.tarkov.dev, the OpenAI API and the Tarkov wiki, for end-to-end testing offline.
//   bun tests/mock-server.ts   (port 7820)
import { snapshotToRaw, loadSnapshot } from "./helpers.ts";

const raw = snapshotToRaw(loadSnapshot());
const DOCS: Record<string, any> = { tasks: raw.tasks, tasks_en: raw.tasksEn, maps: raw.maps, maps_en: raw.mapsEn, traders: raw.traders, traders_en: raw.tradersEn, items_en: raw.itemsEn };
const log: string[] = [];
// what the fake vision model "reads": override with POST /set-rows
let rows: any[] = [
  { name: "Ballet Lover", trader: null, progress: 0 }, { name: "A Fuel Matter", trader: null, progress: 0 },
  { name: "Anesthesia", trader: null, progress: 33 }, { name: "Dandies", trader: null, progress: 0 },
  { name: "The Good Times - Part 1", trader: null, progress: 40 }, { name: "Seizing the Initative", trader: null, progress: 0 },
  { name: "Booze", trader: null, progress: 10 }, { name: "Some Story Chapter", trader: null, progress: null },
];
let fail = false;

Bun.serve({
  port: Number(process.env.MOCK_PORT) || 7820, hostname: "127.0.0.1", idleTimeout: 60,
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname;
    if (p === "/log") return Response.json(log);
    if (p === "/set-rows") { rows = await req.json(); return Response.json({ ok: true }); }
    if (p === "/fail") { fail = (await req.json()).fail; return Response.json({ ok: true }); }
    const jd = p.match(/^\/(regular|pve|pvp-season)\/(\w+)$/);
    if (jd) { log.push("json " + p); if (fail) return new Response("down", { status: 503 }); const d = DOCS[jd[2]]; return d ? Response.json(d) : new Response("nf", { status: 404 }); }
    if (p === "/wiki") { log.push("wiki " + u.searchParams.get("page")); return Response.json({ parse: { title: u.searchParams.get("page"), wikitext: "==Objectives==\n*Do the thing\n==Guide==\nIt's upstairs." } }); }
    if (p.startsWith("/v1/")) {
      if (req.headers.get("authorization") !== "Bearer sk-test_1234567890abcdefghijkl") return Response.json({ error: { message: "Incorrect API key provided" } }, { status: 401 });
      if (p.startsWith("/v1/models/")) return Response.json({ id: p.slice(11) });
      if (p === "/v1/responses") {
        const b: any = await req.json();
        const isVision = JSON.stringify(b.input).includes("input_image");
        log.push(`responses model=${b.model} vision=${isVision} reasoning=${JSON.stringify(b.reasoning || null)} imgBytes=${isVision ? JSON.stringify(b.input).length : 0}`);
        if (isVision) return Response.json({ id: "r1", model: b.model, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ rows }) }] }] });
        const ctx = b.input?.[0]?.content || "";
        const parts = ctx.includes("PARTS:\n") ? JSON.parse(ctx.slice(ctx.indexOf("PARTS:\n") + 7)) : [];
        const keyed = parts.filter((x: any) => x.objectives.some((o: any) => o.keys));
        const ans = { reply: `Moved ${keyed.length} parts that need keys.`, new_categories: [{ name: "Key runs", color: "#4dabf7", icon: "star" }], assignments: keyed.map((x: any) => ({ part_id: x.id, category: "Key runs", reason: "Needs " + x.objectives.find((o: any) => o.keys).keys[0] })) };
        return Response.json({ id: "r2", model: b.model, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(ans) }] }] });
      }
    }
    return new Response("nf", { status: 404 });
  },
});
console.log("mock up");
