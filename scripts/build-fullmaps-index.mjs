// Builds data/fullmaps-index.json from the scanned sheets in FullMaps/.
// Sheet footprints come from the 1:50,000 sheet code; the world file and TIFF size
// are used only to cross-check that each scan sits where its code says it should.
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fullMapsDir = join(root, "FullMaps");
const outputFile = join(root, "data", "fullmaps-index.json");
const releaseBase = process.argv[2] || "";

function tiffSize(path) {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, 0);
    const little = head.toString("latin1", 0, 2) === "II";
    const u16 = (b, o) => (little ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (b, o) => (little ? b.readUInt32LE(o) : b.readUInt32BE(o));
    if (u16(head, 2) !== 42) {
      throw new Error("unsupported TIFF variant");
    }
    const ifdOffset = u32(head, 4);
    const countBuf = Buffer.alloc(2);
    readSync(fd, countBuf, 0, 2, ifdOffset);
    const count = u16(countBuf, 0);
    const entries = Buffer.alloc(count * 12);
    readSync(fd, entries, 0, entries.length, ifdOffset + 2);
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i += 1) {
      const tag = u16(entries, i * 12);
      const type = u16(entries, i * 12 + 2);
      const value = type === 3 ? u16(entries, i * 12 + 8) : u32(entries, i * 12 + 8);
      if (tag === 256) width = value;
      if (tag === 257) height = value;
    }
    return { width, height };
  } finally {
    closeSync(fd);
  }
}

function sheetBounds(code) {
  const match = /^(\d{2})(\d{2})([A-D])([A-D])$/.exec(code);
  if (!match) {
    return null;
  }
  const [, lat, lon, first, second] = match;
  let south = -Number(lat) - 1;
  let west = Number(lon);
  for (const [letter, size] of [[first, 0.5], [second, 0.25]]) {
    if (letter === "A" || letter === "B") south += size;
    if (letter === "B" || letter === "D") west += size;
  }
  const size = 0.25;
  return { west, east: west + size, south, north: south + size };
}

function parseName(base) {
  const parts = base.replace(/_GEO$/i, "").split("_");
  const edition = parts.pop();
  const year = parts.pop();
  const sheets = [];
  let previous = null;
  for (const part of parts) {
    if (/^\d{4}[A-D]{2}$/.test(part)) {
      sheets.push(part);
      previous = part;
    } else if (/^[A-D]{2}$/.test(part) && previous) {
      sheets.push(previous.slice(0, 4) + part);
    }
  }
  return { key: parts.join("_"), sheets, year: Number(year), edition: Number(edition.replace(/^ED/i, "")) };
}

const maps = [];
const problems = [];
for (const folder of readdirSync(fullMapsDir)) {
  const folderPath = join(fullMapsDir, folder);
  if (!statSync(folderPath).isDirectory()) continue;
  for (const name of readdirSync(folderPath)) {
    if (!/\.tif$/i.test(name)) continue;
    const base = name.replace(/\.tif$/i, "");
    const parsed = parseName(base);
    const bounds = parsed.sheets.map(sheetBounds);
    if (!parsed.sheets.length || bounds.some((b) => !b)) {
      problems.push(`${name}: cannot read sheet code`);
      continue;
    }
    const union = {
      west: Math.min(...bounds.map((b) => b.west)),
      east: Math.max(...bounds.map((b) => b.east)),
      south: Math.min(...bounds.map((b) => b.south)),
      north: Math.max(...bounds.map((b) => b.north))
    };
    const tfwPath = join(folderPath, `${base}.tfw`);
    const { width, height } = tiffSize(join(folderPath, name));
    const [a, d, b, e, c, f] = readFileSync(tfwPath, "utf8").trim().split(/\s+/).map(Number);
    const centerLon = a * (width / 2) + b * (height / 2) + c;
    const centerLat = d * (width / 2) + e * (height / 2) + f;
    const inside =
      centerLon > union.west && centerLon < union.east && centerLat > union.south && centerLat < union.north;
    if (!inside) {
      problems.push(`${name}: scan centre ${centerLat.toFixed(4)}, ${centerLon.toFixed(4)} is outside ${parsed.key}`);
    }
    maps.push({
      key: parsed.key,
      sheets: parsed.sheets,
      year: parsed.year,
      edition: parsed.edition,
      file: name,
      world: `${base}.tfw`,
      bytes: statSync(join(folderPath, name)).size,
      pixels: [width, height],
      bounds: union
    });
  }
}

const keys = new Set();
for (const map of maps) {
  if (keys.has(map.key)) problems.push(`${map.key}: duplicate sheet key`);
  keys.add(map.key);
}
maps.sort((x, y) => x.key.localeCompare(y.key));
writeFileSync(outputFile, `${JSON.stringify({ downloadBase: releaseBase, maps })}\n`);
console.log(`${maps.length} scanned sheets indexed.`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
