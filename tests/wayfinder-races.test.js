import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateWayfinderData, validateWayfinderData, legWayfinderMarkings } from "../wayfinder-data.js";

test("imports existing legs and unassigned markings into a race without mutating saved data", () => {
  const old = {
    version: 1,
    legs: [
      { id: "one", name: "LEG 1", description: "", frame: { id: "old", lat: -34, lng: 25, paperSize: "A1" } },
      { id: "two", name: "LEG 2", description: "", frame: { id: "keep", lat: -34, lng: 25, paperSize: "A3" } }
    ],
    markings: [
      { id: "a", type: "cp", name: "CP1", lat: -34, lng: 25, legId: "one" },
      { id: "b", type: "ta", name: "TA1", lat: -34, lng: 25, showOnBlank: true }
    ]
  };
  const ids = ["race", "new-lock", "new-a3-lock", "imported"];
  const data = migrateWayfinderData(old, () => ids.shift());
  assert.equal(validateWayfinderData(data), true);
  assert.deepEqual(data.races, [{ id: "race", name: "Imported race" }]);
  assert.deepEqual(data.legs.map((leg) => leg.raceId), ["race", "race", "race"]);
  assert.deepEqual(data.legs[0].frame, { ...old.legs[0].frame, id: "new-lock", paperSize: "A3", layoutVersion: 2 });
  assert.deepEqual(data.legs[1].frame, { ...old.legs[1].frame, id: "new-a3-lock", layoutVersion: 2 });
  assert.equal(data.markings[1].legId, "imported");
  assert.equal(legWayfinderMarkings(data, "imported", true)[0].id, "b");
  assert.equal(old.legs[0].frame.paperSize, "A1");
  assert.equal(old.markings[1].legId, undefined);
});

test("old A3 locks get a new identity once, while current locks remain unchanged", () => {
  const old = { version: 2, races: [{ id: "race", name: "Race", distanceKm: 120 }],
    legs: [{ id: "leg", raceId: "race", name: "LEG 1", description: "",
      frame: { id: "old", lat: -34, lng: 25, paperSize: "A3" } }], markings: [] };
  const updated = migrateWayfinderData(old, () => "new");
  assert.deepEqual(updated.legs[0].frame, { ...old.legs[0].frame, id: "new", layoutVersion: 2 });
  assert.equal(old.legs[0].frame.id, "old");
  assert.deepEqual(migrateWayfinderData(updated, () => { throw new Error("Already migrated"); }), updated);
  assert.equal(validateWayfinderData(updated), true);
});

test("race distance is optional for existing races and must be finite and positive when set", () => {
  const data = { version: 2, races: [{ id: "race", name: "Race" }], legs: [], markings: [] };
  assert.equal(validateWayfinderData(data), true);
  for (const distanceKm of [120, 0.5]) {
    assert.equal(validateWayfinderData({ ...data, races: [{ ...data.races[0], distanceKm }] }), true);
  }
  for (const distanceKm of [0, -1, Infinity, "120", null]) {
    assert.equal(validateWayfinderData({ ...data, races: [{ ...data.races[0], distanceKm }] }), false);
  }
});

test("empty accounts start without a race; old marker arrays get an imported leg", () => {
  let number = 0;
  const id = () => `id-${++number}`;
  assert.deepEqual(migrateWayfinderData([], id), { version: 2, races: [], legs: [], markings: [] });
  const data = migrateWayfinderData([{ id: "a", type: "label", name: "Start", lat: -34, lng: 25, legId: "old" }], id);
  assert.equal(data.markings[0].legId, data.legs[0].id);
  assert.equal(data.legs[0].raceId, data.races[0].id);
  assert.equal(validateWayfinderData(data), true);
});

test("race data rejects missing parents, invalid drafts and non-A3 locked frames", () => {
  const data = { version: 2, races: [{ id: "race", name: "Race" }],
    legs: [{ id: "leg", raceId: "race", name: "LEG 1", description: "" }], markings: [] };
  assert.equal(validateWayfinderData(data), true);
  assert.equal(validateWayfinderData({ ...data, races: [] }), false);
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...data.legs[0], draft: null }] }), false);
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...data.legs[0],
    frame: { id: "lock", lat: -34, lng: 25, paperSize: "A4" } }] }), false);
  assert.equal(validateWayfinderData({ ...data, markings: [
    { id: "a", type: "label", name: "Point", lat: -34, lng: 25 }
  ] }), false);
});

test("import preserves unassigned markings even when the old leg limit is full", () => {
  const legs = Array.from({ length: 100 }, (_, i) => ({ id: `leg-${i}`, name: `LEG ${i}`, description: "" }));
  const old = { version: 1, legs, markings: [{ id: "a", type: "label", name: "Point", lat: -34, lng: 25 }] };
  let number = 0;
  const data = migrateWayfinderData(old, () => `new-${++number}`);
  assert.equal(data.legs.length, 101);
  assert.equal(data.markings[0].legId, data.legs[100].id);
  assert.equal(validateWayfinderData(data), true);
});

test("legs inherit opted-in markings from the same race inside their map area", () => {
  const point = { type: "ta", name: "TA2", lat: -34, lng: 25, showOnBlank: true };
  const data = {
    legs: [{ id: "one", raceId: "r1" }, { id: "two", raceId: "r1" }, { id: "other", raceId: "r2" }],
    markings: [
      { ...point, id: "a", legId: "one", allowInheritance: true },
      { ...point, id: "b", legId: "one" },
      { ...point, id: "c", legId: "one", allowInheritance: true, lat: -40 },
      { ...point, id: "d", legId: "other", allowInheritance: true },
      { ...point, id: "e", legId: "one", allowInheritance: true, showOnBlank: false },
      { id: "f", type: "path", legId: "one", allowInheritance: true, points: [[-33, 24], [-35, 26]] },
      { ...point, id: "g", legId: "two" }
    ]
  };
  const bounds = { west: 24.9, east: 25.1, south: -34.1, north: -33.9 };
  const ids = (blank) => legWayfinderMarkings(data, "two", blank, bounds).map((marking) => marking.id);
  assert.deepEqual(ids(false), ["g", "a", "e", "f"]);
  assert.deepEqual(ids(true), ["g", "a"]);
  assert.deepEqual(legWayfinderMarkings(data, "two").map((marking) => marking.id), ["g"]);
});
