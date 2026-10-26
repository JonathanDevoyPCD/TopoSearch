import assert from "node:assert/strict";
import test from "node:test";
import { magneticField, magvar } from "../vendor/magvar/magvar.js";

test("WMM2025 matches NCEI reference values", () => {
  const date = new Date("2025-01-01T00:00:00Z");
  assert.equal(magneticField(80, 0, 0, date).declination, 1.28);
  assert.equal(magneticField(0, 120, 0, date).declination, -0.16);
  assert.equal(magneticField(-80, 240, 0, date).declination, 68.78);
});

test("sheet-center declination is calculated for the requested date", () => {
  assert.equal(magvar(-33.875, 25.125, 0, new Date("2026-10-26T00:00:00Z")), -30.28);
});
