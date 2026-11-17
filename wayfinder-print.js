import { mercatorY } from "./print-layout.js";
import { WAYFINDER_COLORS, WAYFINDER_LABEL_POSITIONS, wayfinderMarkerColor } from "./wayfinder-data.js";

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

export function wayfinderPdfCommands(markings, bounds, layout, measureText) {
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
      const stroke = wayfinderMarkerColor(marking);
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
    if (marking.type === "cp" || marking.type === "ta") {
      const [dx, dy] = WAYFINDER_LABEL_POSITIONS[marking.labelPosition ?? "bottom"];
      const nameWidth = measureText(marking.name, 10.4);
      const descriptionWidth = marking.description ? measureText(marking.description, 9) : 0;
      const blockWidth = Math.max(nameWidth, descriptionWidth);
      const blockHeight = marking.description ? 24.5 : 12.8;
      const centerX = mmToPt(point.x + dx * 3.5) + dx * blockWidth / 2;
      const top = mmToPt(pageHeight - point.y - dy * 3.5) + (1 - dy) * blockHeight / 2;
      const nameY = top - mmToPt(2.6);
      const markerText = (value, size, width, textY) => {
        const text = `${number(centerX - width / 2)} ${number(textY)} Td (${pdfEscape(value)}) Tj ET`;
        commands.push(`/Artifact BMC BT /F2 ${size} Tf 1 Tr ${text} EMC`);
        commands.push(`BT /F2 ${size} Tf 0 Tr ${text}`);
      };
      commands.push(`q ${rgb(wayfinderMarkerColor(marking))} rg 1 1 1 RG 0.8 w 1 j`);
      markerText(marking.name, 10.4, nameWidth, nameY);
      if (marking.description) {
        markerText(marking.description, 9, descriptionWidth, nameY - mmToPt(4.1));
      }
      commands.push("Q");
    } else {
      commands.push(`0 0 0 rg BT /F2 9 Tf ${x(textX)} ${y(point.y + 1)} Td (${pdfEscape(marking.name)}) Tj ET`);
    }
  }
  commands.push("Q");
  return commands.join("\n");
}
