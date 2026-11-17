import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth.js";

const origin = "https://jonathandevoypcd.github.io";
const env = { ALLOWED_ORIGIN: origin, SESSION_SECRET: "test-secret" };
const printToken = await signToken({ t: "p", uid: 1 }, env.SESSION_SECRET, 600);
const authorized = { Authorization: `Bearer ${printToken}` };

function makeRequest(path, options = {}) {
  return new Request(`https://toposearch-ngi-proxy.example.workers.dev${path}`, {
    method: options.method || "GET",
    headers: {
      Origin: options.origin || origin,
      ...(options.anonymous ? {} : authorized),
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
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=2592000");
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
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, POST, OPTIONS");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("rejects tile requests without a valid print token", async () => {
  const anonymous = await worker.fetch(makeRequest("/50k/15/18670/13103.png", { anonymous: true }), env);
  const sessionToken = await signToken({ t: "s", uid: 1, v: 1 }, env.SESSION_SECRET, 600);
  const wrongType = await worker.fetch(
    makeRequest("/50k/15/18670/13103.png", {
      anonymous: true,
      headers: { Authorization: `Bearer ${sessionToken}` }
    }),
    env
  );
  const expired = await signToken({ t: "p", uid: 1 }, env.SESSION_SECRET, -10);
  const expiredResponse = await worker.fetch(
    makeRequest("/50k/15/18670/13103.png", {
      anonymous: true,
      headers: { Authorization: `Bearer ${expired}` }
    }),
    env
  );
  assert.equal(anonymous.status, 401);
  assert.equal(wrongType.status, 401);
  assert.equal(expiredResponse.status, 401);
});

test("tokens reject tampering and wrong secrets", async () => {
  const token = await signToken({ t: "s", uid: 7 }, "a", 60);
  assert.equal((await verifyToken(token, "a", "s")).uid, 7);
  assert.equal(await verifyToken(token, "b", "s"), null);
  assert.equal(await verifyToken(`${token}x`, "a", "s"), null);
  assert.equal(await verifyToken(token, "a", "p"), null);
});

test("passwords hash with a salt and verify", async () => {
  const first = await hashPassword("correct horse");
  const second = await hashPassword("correct horse");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse", first), true);
  assert.equal(await verifyPassword("wrong", first), false);
});

test("auth routes validate input before touching the database", async () => {
  const post = (path, body) =>
    worker.fetch(
      new Request(`https://toposearch-ngi-proxy.example.workers.dev${path}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }),
      { ...env, DB: {} },
      { waitUntil() {} }
    );
  assert.equal((await post("/auth/signup", { name: "A", email: "nope", password: "longenough" })).status, 400);
  assert.equal((await post("/auth/signup", { name: "A", email: "a@b.co", password: "short" })).status, 400);
  assert.equal((await post("/pdf/start", {})).status, 401);
});

test("WayFinder saves per account and rejects stale or invalid updates", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    if (error.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && error.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    t.skip("Node SQLite is unavailable");
    return;
  }
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO users (id, email, name, password_hash, created_at)
    VALUES (1, 'one@example.test', 'One', 'x', 'now'), (2, 'two@example.test', 'Two', 'x', 'now')`);
  const binding = {
    prepare(sql) {
      return {
        bind(...values) {
          const args = Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]));
          return {
            async first() { return db.prepare(sql).get(args); },
            async run() {
              const result = db.prepare(sql).run(args);
              return { meta: { changes: Number(result.changes) } };
            }
          };
        }
      };
    }
  };
  const tokens = [
    await signToken({ t: "s", uid: 1, v: 1 }, env.SESSION_SECRET, 60),
    await signToken({ t: "s", uid: 2, v: 1 }, env.SESSION_SECRET, 60)
  ];
  const call = (user, method = "GET", body) => worker.fetch(
    new Request("https://example.test/wayfinder", {
      method,
      headers: { Origin: origin, Authorization: `Bearer ${tokens[user]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), { ...env, DB: binding }
  );
  const point = { id: "a", type: "cp", name: "CP1", description: "Abandoned House", color: "#12ab34", labelPosition: "top-right", lat: -34, lng: 25 };
  assert.deepEqual(await (await call(0)).json(), { revision: 0, markings: [] });
  assert.equal((await call(0, "POST", { revision: 0, markings: [point] })).status, 200);
  assert.deepEqual(await (await call(0)).json(), { revision: 1, markings: [point] });
  assert.deepEqual(await (await call(1)).json(), { revision: 0, markings: [] });
  assert.equal((await call(0, "POST", { revision: 0, markings: [] })).status, 409);
  assert.equal((await call(0, "POST", { revision: 1, markings: [{ ...point, lat: 95 }] })).status, 400);
  assert.equal((await call(0, "POST", { revision: 1, markings: [{ ...point, color: "red" }] })).status, 400);
  assert.equal((await call(0, "POST", { revision: 1, markings: [{ ...point, labelPosition: "center" }] })).status, 400);
  assert.equal((await call(0, "POST", { revision: 1, markings: [] })).status, 200);
  assert.deepEqual(await (await call(0)).json(), { revision: 2, markings: [] });
  const anonymous = await worker.fetch(new Request("https://example.test/wayfinder", {
    headers: { Origin: origin }
  }), { ...env, DB: binding });
  assert.equal(anonymous.status, 401);
});
