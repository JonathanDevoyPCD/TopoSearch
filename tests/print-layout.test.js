import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_SCALE, paperLayout, frameGeometry, clampFrameCenter, mercatorY, rasterZoom } from "../print-layout.js";

const sizes = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
const area = { west: 16, east: 33.5, south: -35, north: -22 };
const radius = 6378137;
const eccentricitySquared = 0.0066943799901413165;

test("each paper size frames the exact map area at 1:50,000 at the centre", () => {
  for (const [size, dimensions] of Object.entries(sizes)) {
    const layout = paperLayout(size);
    assert.deepEqual([layout.pageWidth, layout.pageHeight], dimensions);
    for (const lat of [-34, -28, -23]) {
      const { map, paper } = frameGeometry({ lat, lng: 25 }, size);
      const radians = lat * Math.PI / 180;
      const sin = Math.sin(radians);
      const denominator = 1 - eccentricitySquared * sin * sin;
      const eastScale = Math.cos(radians) / Math.sqrt(denominator);
      const northScale = Math.cos(radians) * (1 - eccentricitySquared) / denominator ** 1.5;
      const groundWidth = (map.east - map.west) * Math.PI / 180 * radius * eastScale;
      const groundHeight = (mercatorY(map.north) - mercatorY(map.south)) * northScale;
      assert.ok(Math.abs(groundWidth / (layout.mapWidth / 1000) - PRINT_SCALE) < 0.001, `${size} width at ${lat}`);
      assert.ok(Math.abs(groundHeight / (layout.mapHeight / 1000) - PRINT_SCALE) < 0.001, `${size} height at ${lat}`);
      assert.ok(paper.west < map.west && paper.east > map.east);
      assert.ok(paper.south < map.south && paper.north > map.north);
    }
  }
});

test("frame clamping keeps the entire paper footprint in the downloadable area", () => {
  for (const size of Object.keys(sizes)) {
    for (const center of [
      { lat: area.south, lng: area.west },
      { lat: area.north, lng: area.east }
    ]) {
      const clamped = clampFrameCenter(center, size, area);
      const { paper } = frameGeometry(clamped, size);
      assert.ok(paper.west >= area.west - 1e-9 && paper.east <= area.east + 1e-9, size);
      assert.ok(paper.south >= area.south - 1e-9 && paper.north <= area.north + 1e-9, size);
    }
  }
});

test("large prints use a bounded raster while smaller prints retain native detail", () => {
  const center = { lat: -28, lng: 25 };
  assert.ok(rasterZoom(frameGeometry(center, "A0").map, 15) < 15);
  assert.equal(rasterZoom(frameGeometry(center, "A4").map, 15), 15);
  assert.equal(rasterZoom(frameGeometry(center, "A4").map, 12), 12);
  assert.throws(() => paperLayout("A5"), /Unsupported paper size/);
});
