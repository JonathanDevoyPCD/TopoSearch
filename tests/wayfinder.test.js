import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWayfinderMarkings } from "../wayfinder-data.js";
import { pdfEscape, projectWayfinderPoint, wayfinderPdfCommands } from "../wayfinder-print.js";
import { mercatorY } from "../print-layout.js";

test("validates marking types, coordinates, names and unique IDs", () => {
  const point = { id: "one", type: "cp", name: "CP1", lat: -34, lng: 25 };
  const highlight = { id: "two", type: "highlight", color: "cyan", width: 100, points: [[-34, 25], [-34.1, 25.1]] };
  assert.equal(validateWayfinderMarkings([point, highlight]), true);
  assert.equal(validateWayfinderMarkings([point, { ...point }]), false);
  assert.equal(validateWayfinderMarkings([{ ...point, lat: 90 }]), false);
  assert.equal(validateWayfinderMarkings([{ ...point, name: "" }]), false);
  assert.equal(validateWayfinderMarkings([{ ...point, name: "漢字" }]), false);
  assert.equal(validateWayfinderMarkings([{ ...highlight, color: "red" }]), false);
  assert.equal(validateWayfinderMarkings([{ ...highlight, width: -1 }]), false);
  assert.equal(validateWayfinderMarkings([{ ...highlight, points: [[-34, 25]] }]), false);
});

test("projects markings into the Web Mercator map area", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  assert.deepEqual(projectWayfinderPoint(-33, 24, bounds, layout), { x: 10, y: 20 });
  assert.deepEqual(projectWayfinderPoint(-35, 26, bounds, layout), { x: 110, y: 220 });
  const middle = projectWayfinderPoint(-34, 25, bounds, layout);
  assert.equal(middle.x, 60);
  assert.ok(Math.abs(middle.y - (20 + 200 * (mercatorY(-33) - mercatorY(-34)) /
    (mercatorY(-33) - mercatorY(-35)))) < 1e-10);
});

test("PDF clips highlights and includes only point centres within the frame", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const markings = [
    { id: "a", type: "cp", name: "CP1", lat: -34, lng: 25 },
    { id: "b", type: "label", name: "Outside", lat: -34, lng: 27 },
    { id: "c", type: "highlight", color: "yellow", width: 100, points: [[-34, 23], [-34, 27]] }
  ];
  const commands = wayfinderPdfCommands(markings, bounds, layout);
  assert.match(commands, /re W n/);
  assert.match(commands, /\/WF gs/);
  assert.match(commands, /\(CP1\) Tj/);
  assert.doesNotMatch(commands, /Outside/);
  assert.equal(pdfEscape("Café (CP1)"), "Caf\\351 \\(CP1\\)");
  const width = (bounds.east - bounds.west) * Math.PI / 180 * 6378137 * 0.05;
  const sized = wayfinderPdfCommands([{ ...markings[2], width }], bounds, layout);
  assert.match(sized, /14\.17 w/);
});
