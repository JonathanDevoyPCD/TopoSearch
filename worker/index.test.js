import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const origin = "https://jonathandevoypcd.github.io";
const env = { ALLOWED_ORIGIN: origin };

function makeRequest(path, options = {}) {
  return new Request(`https://toposearch-ngi-proxy.example.workers.dev${path}`, {
    method: options.method || "GET",
    headers: {
      Origin: options.origin || origin,
      ...options.headers
    }
  });
}

test("allows a valid 50k tile and streams it with the Pages CORS origin", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    upstreamUrl = url;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" }
    });
  };

  const response = await worker.fetch(makeRequest("/50k/15/18670/13103.png"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=86400");
  assert.equal(upstreamUrl, "https://htonl.dev.openstreetmap.org/ngi-tiles/tiles/50k/15/18670/13103.png");
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [137, 80, 78, 71]);
});

test("allows a Loerie 250k tile at its native maximum zoom", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    upstreamUrl = url;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" }
    });
  };

  const response = await worker.fetch(makeRequest("/250k/12/2321/1649.png"), env);
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://htonl.dev.openstreetmap.org/ngi-tiles/tiles/250k/12/2321/1649.png");
});

test("rejects requests without the configured site origin", async () => {
  const response = await worker.fetch(
    makeRequest("/50k/15/18670/13103.png", { origin: "https://attacker.example" }),
    env
  );
  assert.equal(response.status, 403);
});

test("rejects unsupported zooms, query parameters, and tiles outside Loerie", async () => {
  const tooDeep = await worker.fetch(makeRequest("/250k/13/4666/3274.png"), env);
  const query = await worker.fetch(makeRequest("/50k/15/18670/13103.png?url=https://attacker.example"), env);
  const outside = await worker.fetch(makeRequest("/50k/15/0/0.png"), env);
  assert.equal(tooDeep.status, 400);
  assert.equal(query.status, 400);
  assert.equal(outside.status, 404);
});

test("answers CORS preflight without contacting NGI", async () => {
  const response = await worker.fetch(
    makeRequest("/50k/15/18670/13103.png", { method: "OPTIONS" }),
    env
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
});
