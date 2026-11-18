import { pdfEscape, wayfinderPdfCommands } from "./wayfinder-print.js";

const mmToPt = (value) => value * 72 / 25.4;

const BAR_CENTER_X = 148.5;
const BAR_MAX_WIDTH = 150;
const NORTH_BASE_Y = 403.5;
const NORTH_LENGTH = 7.9;

// Layout from the supplied template: a subdivided 1 km section left of zero, then whole kilometres.
// Every width is derived from the print scale, so the bar is physically accurate.
export function a3ScaleBar(scale) {
  const kmWidth = 1000000 / scale;
  const totalKm = Math.max(2, Math.min(10, Math.floor(BAR_MAX_WIDTH / kmWidth)));
  const x = BAR_CENTER_X - totalKm * kmWidth / 2;
  return {
    x, y: 390, kmWidth, leftCells: 5, mainKm: totalKm - 1, zeroX: x + kmWidth,
    totalWidth: totalKm * kmWidth
  };
}

export function a3PdfCommands({ layout, lines, scale, markings, leg, race, measureText }) {
  const { pageHeight, mapX, mapY, mapWidth, mapHeight } = layout;
  const commands = [];
  const pt = (value) => mmToPt(value).toFixed(2);
  const text = (value, x, y, size, font = "F1") => {
    commands.push(`0 0 0 rg BT /${font} ${size.toFixed(2)} Tf ${pt(x)} ${pt(pageHeight - y)} Td (${pdfEscape(value)}) Tj ET`);
  };
  const centered = (value, x, y, size, font = "F1", maxWidth = Infinity) => {
    const width = measureText(value, size, font) * 25.4 / 72;
    const fittedSize = width > maxWidth ? size * maxWidth / width : size;
    const fittedWidth = measureText(value, fittedSize, font) * 25.4 / 72;
    text(value, x - fittedWidth / 2, y, fittedSize, font);
  };
  const footerText = (value, y) => {
    const size = 5.2;
    const width = measureText(value, size, "F1") * 25.4 / 72;
    text(value, 7.1, y, width > 235 ? size * 235 / width : size);
  };
  const line = (x1, y1, x2, y2, width = 0.2) => {
    commands.push(`[] 0 d 0 0 0 RG ${pt(width)} w ${pt(x1)} ${pt(pageHeight - y1)} m ${pt(x2)} ${pt(pageHeight - y2)} l S`);
  };
  const arrow = (x, y, degrees) => {
    const radians = degrees * Math.PI / 180;
    const along = [Math.sin(radians), -Math.cos(radians)];
    const across = [-along[1], along[0]];
    const tip = [x + along[0] * NORTH_LENGTH, y + along[1] * NORTH_LENGTH];
    const back = [tip[0] - along[0] * 1.1, tip[1] - along[1] * 1.1];
    const left = [back[0] + across[0] * 0.65, back[1] + across[1] * 0.65];
    const right = [back[0] - across[0] * 0.65, back[1] - across[1] * 0.65];
    line(x, y, back[0], back[1], 0.2);
    commands.push(`0 0 0 rg ${pt(tip[0])} ${pt(pageHeight - tip[1])} m ${pt(left[0])} ${pt(pageHeight - left[1])} l ` +
      `${pt(right[0])} ${pt(pageHeight - right[1])} l h f`);
  };
  const rectangle = (x, y, width, height, fill = null, strokeWidth = 0.2) => {
    const path = `${pt(x)} ${pt(pageHeight - y - height)} ${pt(width)} ${pt(height)} re`;
    if (fill) commands.push(`${fill} rg ${path} f`);
    commands.push(`0 0 0 RG ${pt(strokeWidth)} w ${path} S`);
  };

  commands.push(`q ${pt(mapWidth)} 0 0 ${pt(mapHeight)} ${pt(mapX)} ${pt(pageHeight - mapY - mapHeight)} cm /Im0 Do Q`);
  commands.push(wayfinderPdfCommands(markings, lines.bounds, layout, (value, size) => measureText(value, size, "F2")));
  rectangle(mapX, mapY, mapWidth, mapHeight, null, 0.35);

  // The logo position and footer geometry are from the supplied A3 design.
  commands.push(`q ${pt(61.1)} 0 0 ${pt(24)} ${pt(7.1)} ${pt(pageHeight - 379.1 - 24)} cm /Im1 Do Q`);
  const bar = a3ScaleBar(scale);
  const barHeight = 0.85;
  const cellWidth = bar.kmWidth / bar.leftCells;
  for (let index = 0; index < bar.leftCells; index += 1) {
    rectangle(bar.x + index * cellWidth, bar.y, cellWidth, barHeight, index % 2 === 0 ? "0 0 0" : "1 1 1", 0.12);
  }
  for (let index = 0; index < bar.mainKm; index += 1) {
    rectangle(bar.zeroX + index * bar.kmWidth, bar.y, bar.kmWidth, barHeight, index % 2 === 0 ? "0 0 0" : "1 1 1", 0.12);
  }
  centered("1000", bar.x, bar.y - 1.5, 5);
  for (let index = 0; index <= bar.mainKm; index += 1) {
    centered(String(index), bar.zeroX + index * bar.kmWidth, bar.y - 1.5, 5);
  }
  const metersWidth = measureText("Meters", 5, "F1") * 25.4 / 72;
  text("Meters", bar.x - metersWidth - 1.5, bar.y + 0.8, 5);
  text("Kilometers", bar.x + bar.totalWidth + 1.5, bar.y + 0.8, 5);

  // True north (vertical) and magnetic north (angled by the declination, east positive), sharing a baseline.
  const declination = Number.isFinite(lines.declination) ? lines.declination : 0;
  line(BAR_CENTER_X - 7.85, NORTH_BASE_Y, BAR_CENTER_X + 7.85, NORTH_BASE_Y, 0.2);
  arrow(BAR_CENTER_X, NORTH_BASE_Y, 0);
  arrow(BAR_CENTER_X, NORTH_BASE_Y, declination);
  const tipX = BAR_CENTER_X + NORTH_LENGTH * Math.sin(declination * Math.PI / 180);
  const westward = declination <= 0;
  const magLabel = "Mag. N.";
  const magWidth = measureText(magLabel, 5, "F1") * 25.4 / 72;
  text(magLabel, westward ? tipX - magWidth - 1 : tipX + 1, NORTH_BASE_Y - NORTH_LENGTH + 3, 5);
  const trueWidth = measureText("True N.", 5, "F1") * 25.4 / 72;
  text("True N.", westward ? BAR_CENTER_X + 1.5 : BAR_CENTER_X - trueWidth - 1.5, NORTH_BASE_Y - NORTH_LENGTH / 2 + 1, 5);

  rectangle(248.7, 381, 41.3, 18.7, "1 1 1", 0.2);
  centered(leg?.name ?? "MAP", 269.35, 390.8, 20, "F2", 38);
  const distance = race?.distanceKm === undefined ? "Distance not set" : `${race.distanceKm} km Race`;
  centered(distance, 269.35, 396, 7, "F2", 38);
  centered("Scale", 259, 406.5, 7);
  centered("Declination", 280, 406.5, 7);
  centered(`1:${String(scale).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`, 259, 411.5, 9);
  centered(lines.declinationLabel, 280, 411.5, 7, "F1", 20);

  footerText(lines.satellite ? "NGI aerial imagery; image dates vary." : lines.sourceLabel, 407);
  footerText(lines.attribution, 409.3);
  footerText(`${lines.source} | Raster zoom ${lines.sourceZoom}`, 411.6);
  footerText(lines.extent, 413.9);
  footerText(`${lines.generated} | Declination: ${lines.declinationModel}`, 416.2);
  footerText(lines.satellite && lines.missingTiles
    ? "Grey areas: no aerial imagery available. Verify local conditions."
    : "Verify map currency and local conditions before navigation.", 418.5);
  return commands.join("\n");
}
