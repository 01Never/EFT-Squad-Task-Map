// Server-Sent Events to the page. Idle connections cost nothing; no polling anywhere.
import { enqueue, pendingEvents } from "./store.ts";

type Client = { ctrl: ReadableStreamDefaultController<Uint8Array> };
const clients = new Set<Client>();
const enc = new TextEncoder();

function write(c: Client, ev: any) {
  try { c.ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { clients.delete(c); }
}

/** Live-only event (GPS fix, capture progress, status) — dropped if no page is open. */
export function broadcast(ev: any) { for (const c of clients) write(c, ev); }
/** Event the page must apply to saved data (task started/finished, raid end) — kept until the page acks it. */
export function deliver(ev: any) { const e = enqueue(ev); broadcast(e); }
export const clientCount = () => clients.size;

export function sseResponse(): Response {
  let client: Client;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      client = { ctrl };
      clients.add(client);
      ctrl.enqueue(enc.encode(": hi\n\n"));
      for (const e of pendingEvents()) write(client, e);
    },
    cancel() { clients.delete(client); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
