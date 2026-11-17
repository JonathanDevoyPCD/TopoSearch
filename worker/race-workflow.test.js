import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "./index.js";
import { signToken } from "./auth.js";

test("saved race legs retain paired download quota accounting", async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    if (error.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    t.skip("Node SQLite is unavailable");
    return;
  }
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  db.exec("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (1, 'one@example.test', 'One', 'x', 'now')");
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          const args = Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]));
          return {
            async first() { return db.prepare(sql).get(args); },
            async run() { return { meta: { changes: Number(db.prepare(sql).run(args).changes) } }; }
          };
        }
      };
    }
  };
  const origin = "https://jonathandevoypcd.github.io";
  const env = { DB, ALLOWED_ORIGIN: origin, SESSION_SECRET: "test-secret" };
  const token = await signToken({ t: "s", uid: 1, v: 1 }, env.SESSION_SECRET, 60);
  const post = (path, body) => worker.fetch(new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), env);
  const data = { version: 2, races: [{ id: "race", name: "Race" }],
    legs: [{ id: "leg", raceId: "race", name: "LEG 1", description: "",
      frame: { id: "lock", lat: -34, lng: 25, paperSize: "A3" } }], markings: [] };
  assert.equal((await post("/wayfinder", { revision: 0, markings: data })).status, 200);
  const pair = { legId: "leg", lockId: "lock", layer: "50k", source: "online", imagery: "topographic" };
  const first = await post("/pdf/start", { legPair: pair });
  const second = await post("/pdf/start", { legPair: pair });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).quota.used, 1);
  assert.equal((await second.json()).quota.used, 1);
});
