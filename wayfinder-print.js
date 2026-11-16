import { mercatorY } from "./print-layout.js";
import { WAYFINDER_COLORS } from "./wayfinder-data.js";

const mmToPt = (value) => value * 72 / 25.4;
const number = (value) => value.toFixed(2);

export function pdfEscape(value) {
  return value.replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .replace(/[\\()]/g, "\\$&")
    .replace(/[\xa0-\xff]/g, (character) => `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

export function projectWayfinderPoint(lat, lng, bounds, layout) {
  const top = mercatorY(bounds.north);
  const bottom = mercatorY(bounds.south);
  return {
    x: layout.mapX + (lng - bounds.west) / (bounds.east - bounds.west) * layout.mapWidth,
    y: layout.mapY + (top - mercatorY(lat)) / (top - bottom) * layout.mapHeight
  };
}

export function wayfinderPdfCommands(markings, bounds, layout) {
  if (!markings.length) {
    return "";
  }
  const { pageHeight, mapX, mapY, mapWidth, mapHeight } = layout;
  const x = (mm) => number(mmToPt(mm));
  const y = (mm) => number(mmToPt(pageHeight - mm));
  const project = (point) => projectWayfinderPoint(point[0], point[1], bounds, layout);
  const rgb = (hex) => [1, 3, 5].map((offset) => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(" ");
  const commands = [
    `q ${x(mapX)} ${y(mapY + mapHeight)} ${x(mapWidth)} ${x(mapHeight)} re W n`
  ];

  for (const marking of markings) {
    if (marking.type !== "highlight") {
      continue;
    }
    const points = marking.points.map(project);
    const projectedWidth = (bounds.east - bounds.west) * Math.PI / 180 * 6378137;
    const strokeWidth = marking.width / projectedWidth * mapWidth;
    commands.push(`q /WF gs ${rgb(WAYFINDER_COLORS[marking.color])} RG ${x(strokeWidth)} w 1 J 1 j`);
    commands.push(`${x(points[0].x)} ${y(points[0].y)} m`);
    for (const point of points.slice(1)) {
      commands.push(`${x(point.x)} ${y(point.y)} l`);
    }
    commands.push("S Q");
  }

  for (const marking of markings) {
    if (marking.type === "highlight" || marking.lat < bounds.south || marking.lat > bounds.north ||
        marking.lng < bounds.west || marking.lng > bounds.east) {
      continue;
    }
    const point = project([marking.lat, marking.lng]);
    if (marking.type !== "label") {
      const stroke = marking.type === "cp" ? "#e5007d" : marking.type === "ta" ? "#006de5" : "#000000";
      const radius = 2.5;
      const k = radius * 0.5522847498;
      commands.push(`${rgb(stroke)} RG ${x(0.45)} w`);
      commands.push(`${x(point.x + radius)} ${y(point.y)} m`);
      commands.push(`${x(point.x + radius)} ${y(point.y - k)} ${x(point.x + k)} ${y(point.y - radius)} ${x(point.x)} ${y(point.y - radius)} c`);
      commands.push(`${x(point.x - k)} ${y(point.y - radius)} ${x(point.x - radius)} ${y(point.y - k)} ${x(point.x - radius)} ${y(point.y)} c`);
      commands.push(`${x(point.x - radius)} ${y(point.y + k)} ${x(point.x - k)} ${y(point.y + radius)} ${x(point.x)} ${y(point.y + radius)} c`);
      commands.push(`${x(point.x + k)} ${y(point.y + radius)} ${x(point.x + radius)} ${y(point.y + k)} ${x(point.x + radius)} ${y(point.y)} c S`);
    }
    const textX = point.x + (marking.type === "label" ? 0 : 3.5);
    commands.push(`0 0 0 rg BT /F2 9 Tf ${x(textX)} ${y(point.y + 1)} Td (${pdfEscape(marking.name)}) Tj ET`);
  }
  commands.push("Q");
  return commands.join("\n");
}
