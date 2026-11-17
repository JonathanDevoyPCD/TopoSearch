import { test } from "node:test";
import assert from "node:assert/strict";
import { legWayfinderMarkings, validateWayfinderData, validateWayfinderMarkings, visibleWayfinderMarkings, wayfinderMarkerColor } from "../wayfinder-data.js";
import { pdfEscape, projectWayfinderPoint, wayfinderPdfCommands } from "../wayfinder-print.js";
import { mercatorY } from "../print-layout.js";

const measureText = (value, size) => value.length * size / 2;

test("validates leg data and preserves legacy markings", () => {
  const point = { id: "one", type: "cp", name: "CP1", lat: -34, lng: 25 };
  const leg = { id: "leg-one", name: "LEG 1", description: "Bike" };
  const data = { version: 1, legs: [leg], markings: [{ ...point, legId: leg.id, showOnBlank: true }] };
  assert.equal(validateWayfinderData([point]), true);
  assert.equal(validateWayfinderData(data), true);
  assert.equal(validateWayfinderData({ ...data, legs: [] }), false);
  assert.equal(validateWayfinderData({ ...data, legs: [leg, leg] }), false);
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...leg, description: "漢字" }] }), false);
  assert.equal(validateWayfinderData({ ...data, markings: [{ ...point, showOnBlank: "yes" }] }), false);
  assert.equal(validateWayfinderData({ ...data, version: 2 }), false);
  const frame = { id: "lock-one", lat: -34, lng: 25, paperSize: "A3" };
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...leg, frame }] }), true);
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...leg, frame: { ...frame, paperSize: "A8" } }] }), false);
  assert.equal(validateWayfinderData({ ...data, legs: [{ ...leg, frame: { ...frame, lat: 100 } }] }), false);
});

test("leg master and blank PDFs contain only that leg's selected markers", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const markings = [
    { id: "a", type: "cp", name: "CP1", lat: -34, lng: 25, legId: "one", showOnBlank: true },
    { id: "b", type: "ta", name: "TA1", lat: -34, lng: 25, legId: "one" },
    { id: "c", type: "cp", name: "CP2", lat: -34, lng: 25, legId: "two", showOnBlank: true }
  ];
  const render = (blank) => wayfinderPdfCommands(legWayfinderMarkings({ markings }, "one", blank), bounds, layout, measureText);
  assert.match(render(false), /\(CP1\) Tj/);
  assert.match(render(false), /\(TA1\) Tj/);
  assert.doesNotMatch(render(false), /\(CP2\) Tj/);
  assert.match(render(true), /\(CP1\) Tj/);
  assert.doesNotMatch(render(true), /\(TA1\) Tj/);
  assert.doesNotMatch(render(true), /\(CP2\) Tj/);
});

test("master, blank and leg views select the same markings for map and PDF", () => {
  const markings = [
    { id: "a", legId: "leg-one", showOnBlank: true },
    { id: "b", legId: "leg-two" },
    { id: "c", showOnBlank: true },
    { id: "d" }
  ];
  assert.deepEqual(visibleWayfinderMarkings({ markings }, "master"), markings);
  assert.deepEqual(visibleWayfinderMarkings({ markings }, "blank").map((marking) => marking.id), ["a", "c"]);
  assert.deepEqual(visibleWayfinderMarkings({ markings }, "leg-one").map((marking) => marking.id), ["a"]);
  assert.deepEqual(visibleWayfinderMarkings({ markings }, "leg-two").map((marking) => marking.id), ["b"]);
  assert.deepEqual(visibleWayfinderMarkings({ markings }, "missing"), []);
});

test("PDF output contains only markings selected for the map", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const markings = [
    { id: "a", type: "cp", name: "CP1", lat: -34, lng: 25, legId: "leg-one" },
    { id: "b", type: "ta", name: "TA1", lat: -34, lng: 25, legId: "leg-two", showOnBlank: true }
  ];
  const render = (view) => wayfinderPdfCommands(visibleWayfinderMarkings({ markings }, view), bounds, layout, measureText);
  assert.match(render("master"), /\(CP1\) Tj/);
  assert.match(render("master"), /\(TA1\) Tj/);
  assert.match(render("leg-one"), /\(CP1\) Tj/);
  assert.doesNotMatch(render("leg-one"), /\(TA1\) Tj/);
  assert.match(render("blank"), /\(TA1\) Tj/);
  assert.doesNotMatch(render("blank"), /\(CP1\) Tj/);
});

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

test("validates optional checkpoint and transition descriptions and colours", () => {
  const cp = { id: "one", type: "cp", name: "CP1", lat: -34, lng: 25 };
  const ta = { ...cp, type: "ta", name: "TA1" };
  assert.equal(validateWayfinderMarkings([cp]), true);
  assert.equal(wayfinderMarkerColor(cp), "#e5007d");
  assert.equal(wayfinderMarkerColor(ta), "#006de5");
  assert.equal(validateWayfinderMarkings([{ ...cp, description: "", color: "#Aa12Ff" }]), true);
  assert.equal(validateWayfinderMarkings([{ ...ta, description: "Ferry Hotel", color: "#123456" }]), true);
  for (const description of [null, "漢字", "x".repeat(81)]) {
    assert.equal(validateWayfinderMarkings([{ ...cp, description }]), false);
  }
  for (const color of [null, "red", "#fff", "#00000000"]) {
    assert.equal(validateWayfinderMarkings([{ ...cp, color }]), false);
  }
});

test("validates marker label positions and accepts older markings", () => {
  const marker = { id: "one", type: "cp", name: "CP1", lat: -34, lng: 25 };
  assert.equal(validateWayfinderMarkings([marker]), true);
  for (const labelPosition of ["top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left"]) {
    assert.equal(validateWayfinderMarkings([{ ...marker, labelPosition }]), true);
  }
  for (const labelPosition of ["center", "constructor", "", null, 1]) {
    assert.equal(validateWayfinderMarkings([{ ...marker, labelPosition }]), false);
  }
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

test("PDF renders marker descriptions in matching colour with a white stroke", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const markings = [
    { id: "a", type: "cp", name: "CP1", description: "Café (old)", color: "#ff8000", lat: -34, lng: 25 },
    { id: "b", type: "ta", name: "TA1", lat: -34, lng: 25 },
    { id: "c", type: "start", name: "Start", lat: -34, lng: 25 }
  ];
  const commands = wayfinderPdfCommands(markings, bounds, layout, measureText);
  assert.match(commands, /1\.000 0\.502 0\.000 RG/);
  const outline = /q 1\.000 0\.502 0\.000 rg 1 1 1 RG (\d+(?:\.\d+)?) w 1 j/.exec(commands);
  assert.ok(outline && Number(outline[1]) > 0);
  assert.match(commands, /\/Artifact BMC BT \/F2 10\.4 Tf 1 Tr ([\d.]+) ([\d.]+) Td \(CP1\) Tj ET EMC\nBT \/F2 10\.4 Tf 0 Tr \1 \2 Td \(CP1\) Tj ET/);
  assert.match(commands, /\/Artifact BMC BT \/F2 9 Tf 1 Tr ([\d.]+) ([\d.]+) Td \(Caf\\351 \\\(old\\\)\) Tj ET EMC\nBT \/F2 9 Tf 0 Tr \1 \2 Td \(Caf\\351 \\\(old\\\)\) Tj ET/);
  assert.match(commands, /q 0\.000 0\.427 0\.898 rg 1 1 1 RG/);
  assert.match(commands, /0 0 0 rg BT \/F2 9 Tf .*?\(Start\) Tj/);
});

test("PDF places both marker labels centred below the circle", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const marker = { id: "a", type: "cp", name: "CP1", description: "Abandoned House", lat: -34, lng: 25 };
  const commands = wayfinderPdfCommands([marker], bounds, layout, measureText);
  const name = /\/F2 10\.4 Tf 0 Tr ([\d.]+) ([\d.]+) Td \(CP1\)/.exec(commands);
  const description = /\/F2 9 Tf 0 Tr ([\d.]+) ([\d.]+) Td \(Abandoned House\)/.exec(commands);
  assert.ok(name && description);
  const point = projectWayfinderPoint(marker.lat, marker.lng, bounds, layout);
  const centerX = point.x * 72 / 25.4;
  assert.ok(Math.abs(Number(name[1]) + measureText(marker.name, 10.4) / 2 - centerX) < 0.01);
  assert.ok(Math.abs(Number(description[1]) + measureText(marker.description, 9) / 2 - centerX) < 0.01);
  assert.ok(Number(name[2]) < (layout.pageHeight - point.y - 2.5) * 72 / 25.4);
  assert.ok(Number(description[2]) < Number(name[2]));
});

test("PDF places both label lines in each selected direction", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const marker = { id: "a", type: "ta", name: "TA1", description: "Ferry Hotel", lat: -34, lng: 25 };
  const point = projectWayfinderPoint(marker.lat, marker.lng, bounds, layout);
  const px = point.x * 72 / 25.4;
  const py = (layout.pageHeight - point.y) * 72 / 25.4;
  const radius = 2.5 * 72 / 25.4;
  const directions = {
    top: [0, -1], "top-right": [1, -1], right: [1, 0], "bottom-right": [1, 1],
    bottom: [0, 1], "bottom-left": [-1, 1], left: [-1, 0], "top-left": [-1, -1]
  };
  for (const [labelPosition, [dx, dy]] of Object.entries(directions)) {
    const commands = wayfinderPdfCommands([{ ...marker, labelPosition }], bounds, layout, measureText);
    const name = /\/F2 10\.4 Tf 0 Tr ([\d.]+) ([\d.]+) Td \(TA1\)/.exec(commands);
    const description = /\/F2 9 Tf 0 Tr ([\d.]+) ([\d.]+) Td \(Ferry Hotel\)/.exec(commands);
    assert.ok(name && description, labelPosition);
    const center = Number(name[1]) + measureText(marker.name, 10.4) / 2;
    assert.ok(Math.abs(center - (Number(description[1]) + measureText(marker.description, 9) / 2)) < 0.02, labelPosition);
    const width = Math.max(measureText(marker.name, 10.4), measureText(marker.description, 9));
    const top = Number(name[2]) + 2.6 * 72 / 25.4;
    const bottom = top - 24.5;
    if (dx < 0) assert.ok(center + width / 2 < px - radius, labelPosition);
    if (dx > 0) assert.ok(center - width / 2 > px + radius, labelPosition);
    if (dx === 0) assert.ok(Math.abs(center - px) < 0.01, labelPosition);
    if (dy < 0) assert.ok(bottom > py + radius, labelPosition);
    if (dy > 0) assert.ok(top < py - radius, labelPosition);
    if (dy === 0) assert.ok(Math.abs((top + bottom) / 2 - py) < 0.01, labelPosition);
  }
});

test("PDF clips highlights and includes only point centres within the frame", () => {
  const bounds = { west: 24, east: 26, north: -33, south: -35 };
  const layout = { pageHeight: 297, mapX: 10, mapY: 20, mapWidth: 100, mapHeight: 200 };
  const markings = [
    { id: "a", type: "cp", name: "CP1", lat: -34, lng: 25 },
    { id: "b", type: "label", name: "Outside", lat: -34, lng: 27 },
    { id: "c", type: "highlight", color: "yellow", width: 100, points: [[-34, 23], [-34, 27]] }
  ];
  const commands = wayfinderPdfCommands(markings, bounds, layout, measureText);
  assert.match(commands, /re W n/);
  assert.match(commands, /\/WF gs/);
  assert.match(commands, /\(CP1\) Tj/);
  assert.doesNotMatch(commands, /Outside/);
  assert.equal(pdfEscape("Café (CP1)"), "Caf\\351 \\(CP1\\)");
  const width = (bounds.east - bounds.west) * Math.PI / 180 * 6378137 * 0.05;
  const sized = wayfinderPdfCommands([{ ...markings[2], width }], bounds, layout);
  assert.match(sized, /14\.17 w/);
});
