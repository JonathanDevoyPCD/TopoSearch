import { test } from "node:test";
import assert from "node:assert/strict";
import { a3PdfCommands, a3ScaleBar } from "../a3-print.js";
import { paperLayout } from "../print-layout.js";

test("A3 scale bar represents five kilometres at the selected print scale", () => {
  for (const scale of [50000, 25000]) {
    const bar = a3ScaleBar(scale);
    assert.equal(bar.segmentWidth * bar.segments * scale / 1000000, 5);
  }
});

test("A3 footer uses the exported leg and its race, with dynamic scale and declination", () => {
  const lines = {
    bounds: { west: 24, east: 26, south: -35, north: -33 },
    declinationLabel: "24.52 degrees W", declinationModel: "WMM2025 2026-01-01",
    sourceLabel: "NGI topographic source", attribution: "State Copyright - NGI",
    source: "Online NGI tiles", sourceZoom: 15, generated: "Generated today", extent: "Extent"
  };
  const render = (leg, race) => a3PdfCommands({
    layout: paperLayout("A3"), lines, scale: 50000, markings: [], leg, race,
    measureText: (value, size) => value.length * size / 2
  });
  const output = render({ name: "LEG 3" }, { distanceKm: 120 });
  assert.match(output, /\(LEG 3\)/);
  assert.match(output, /\(120 km Race\)/);
  assert.match(output, /\(1:50 000\)/);
  assert.match(output, /\(24\.52 degrees W\)/);
  assert.match(output, /\/Im0 Do/);
  assert.match(output, /\/Im1 Do/);
  assert.match(output, /\(State Copyright - NGI\)/);
  assert.match(render({ name: "LEG 4" }, { distanceKm: 42.5 }), /\(42\.5 km Race\)/);
});
