import { pdfEscape, wayfinderPdfCommands } from "./wayfinder-print.js";

const mmToPt = (value) => value * 72 / 25.4;

export function a3ScaleBar(scale) {
  const segmentKm = 1;
  return { x: 93, y: 390, segments: 5, segmentKm, segmentWidth: segmentKm * 1000000 / scale };
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
  for (let index = 0; index < bar.segments; index += 1) {
    rectangle(bar.x + index * bar.segmentWidth, bar.y, bar.segmentWidth, 0.85,
      index % 2 === 0 ? "0 0 0" : "1 1 1", 0.12);
  }
  for (let index = 0; index <= bar.segments; index += 1) {
    centered(String(index * bar.segmentKm), bar.x + index * bar.segmentWidth, bar.y - 1.5, 5);
  }
  text("Kilometres", bar.x + bar.segments * bar.segmentWidth + 2, bar.y + 0.8, 5);
  line(148.5, 395.5, 148.5, 403.2);
  line(147.9, 396.3, 148.5, 395.5);
  line(149.1, 396.3, 148.5, 395.5);
  text("True N.", 150, 399.5, 5);

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
