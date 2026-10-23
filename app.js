const NGI_ROOT = "https://htonl.dev.openstreetmap.org/ngi-tiles";
const LOCAL_TILE_ROOT = "./tiles";
const SHEET_INDEX_URLS = {
  "50k": "./data/loerie-sheets.geojson",
  "250k": "./data/loerie-250k-sheets.geojson"
};
const TARGET_SHEET = "3325CC";
const INITIAL_CENTER = [-33.875, 25.125];
const INITIAL_ZOOM = 10;
const TILE_SIZE = 256;
const EARTH_RADIUS_METERS = 6378137;
const NATIVE_ZOOM = { "50k": 15, "250k": 12 };
const MAP_SCALE = { "50k": 50000, "250k": 250000 };
const PDF_WORKER_BASE_URL = "";
const IS_GITHUB_PAGES =
  window.location.hostname.endsWith(".github.io") && window.location.hostname !== "localhost";

const statusElement = document.querySelector("#map-status");
const layerSelect = document.querySelector("#map-layer");
const sourceSelect = document.querySelector("#tile-source");
const sheetIndexToggle = document.querySelector("#sheet-index");
const coordinateOutput = document.querySelector("#coordinates");
const selectedSheetElement = document.querySelector("#selected-sheet");
const selectedSheetNameElement = document.querySelector("#selected-sheet-name");
const printButton = document.querySelector("#print-map");
const cancelPrintButton = document.querySelector("#cancel-print");

const map = L.map("map", {
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  minZoom: 4,
  maxZoom: 15,
  zoomControl: true
});

const attribution =
  'State Copyright &copy; Chief Directorate: National Geo-spatial Information (NGI)';

let tileLayer;
let sheetLayer;
let sheetCollections = {};
let selectedSheets = {};
let selectedSheet = null;
let tileErrors = 0;
let printController = null;

function setStatus(message, state = "info") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

function tileUrl(layerName) {
  const root = sourceSelect.value === "offline" ? LOCAL_TILE_ROOT : NGI_ROOT;
  return `${root}/tiles/${layerName}/{z}/{x}/{y}.png`;
}

function createTileLayer() {
  const layerName = layerSelect.value;
  return L.tileLayer(tileUrl(layerName), {
    tms: true,
    maxZoom: 15,
    maxNativeZoom: NATIVE_ZOOM[layerName],
    attribution
  });
}

function replaceTileLayer() {
  tileErrors = 0;
  if (tileLayer) {
    map.removeLayer(tileLayer);
  }

  tileLayer = createTileLayer();
  tileLayer.on("tileerror", () => {
    tileErrors += 1;
    if (sourceSelect.value === "offline") {
      setStatus(
        "Local tiles are missing or unavailable. Add an authorized tile pack under tiles/50k or tiles/250k.",
        "error"
      );
    } else if (tileErrors === 1) {
      setStatus("Some online map tiles could not be loaded. Check your connection and try again.", "error");
    }
  });
  tileLayer.addTo(map);

  if (sourceSelect.value === "offline") {
    setStatus("Using local tiles. If blank, add an authorized tile pack under the tiles folder.");
  } else {
    setStatus("Using NGI online topographic tiles.");
  }
}

function sheetName(feature) {
  return feature.properties.s === TARGET_SHEET ? "Loerie" : "";
}

function styleSheet(feature) {
  const isSelected = selectedSheet && feature === selectedSheet;
  return {
    color: isSelected ? "#d14d2a" : "#304539",
    weight: isSelected ? 3 : 1,
    opacity: isSelected ? 1 : 0.7,
    fillColor: isSelected ? "#f0b27e" : "#c8d6a5",
    fillOpacity: isSelected ? 0.18 : 0.04
  };
}

function updateSelectedSheetDetails() {
  if (!selectedSheet) {
    selectedSheetElement.textContent = "No sheet";
    selectedSheetNameElement.textContent = "";
    printButton.disabled = true;
    return;
  }
  selectedSheetElement.textContent = selectedSheet.properties.s;
  selectedSheetNameElement.textContent = sheetName(selectedSheet);
  printButton.disabled = Boolean(printController) || (IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL);
}

function renderSheetLayer() {
  if (sheetLayer) {
    sheetLayer.eachLayer((layer) => {
      layer.closePopup();
      layer.closeTooltip();
    });
    map.removeLayer(sheetLayer);
  }
  const collection = sheetCollections[layerSelect.value];
  if (!collection) {
    return;
  }
  sheetLayer = L.geoJSON(collection, {
    style: styleSheet,
    onEachFeature
  });
  if (sheetIndexToggle.checked) {
    sheetLayer.addTo(map);
  }
}

function selectSheet(feature, fit = true) {
  selectedSheet = feature;
  selectedSheets[layerSelect.value] = feature;
  updateSelectedSheetDetails();
  renderSheetLayer();
  if (fit) {
    map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [32, 32] });
  }
  setStatus(`Selected sheet ${feature.properties.s}, edition ${feature.properties.e} (${feature.properties.y}).`);
}

function onEachFeature(feature, layer) {
  const { s: sheet, e: edition, y: year } = feature.properties;
  const name = sheetName(feature);
  layer.bindPopup(
    `<strong>Sheet ${sheet}${name ? ` · ${name}` : ""}</strong><br>Edition ${edition} (${year})`
  );
  layer.on("click", () => selectSheet(feature, false));
}

async function loadSheetIndex() {
  try {
    const loadedCollections = await Promise.all(
      Object.entries(SHEET_INDEX_URLS).map(async ([layerName, url]) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Sheet index request failed for ${layerName}: ${response.status} ${response.statusText}`
          );
        }
        return [layerName, await response.json()];
      })
    );
    sheetCollections = Object.fromEntries(loadedCollections);

    for (const [layerName, collection] of Object.entries(sheetCollections)) {
      const target = collection.features.find((feature) => feature.properties.s === TARGET_SHEET);
      selectedSheets[layerName] = target || collection.features[0] || null;
    }

    selectedSheet = selectedSheets[layerSelect.value];
    if (!selectedSheet) {
      throw new Error(`No map sheets are available for the ${layerSelect.value} layer.`);
    }
    updateSelectedSheetDetails();
    renderSheetLayer();
    const selectedDetails =
      `Selected ${selectedSheet.properties.s}, edition ${selectedSheet.properties.e} (${selectedSheet.properties.y}).`;
    setStatus(
      IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL
        ? `Online map ready. ${selectedDetails} ${PDF_WORKER_BASE_URL ? "PDF downloads use the Cloudflare Worker." : "Deploy the Cloudflare Worker and configure its URL to enable PDF downloads."}`
        : `Sheet index loaded. ${selectedDetails}`
    );
  } catch (error) {
    setStatus(`Could not load the local sheet index: ${error.message}`, "error");
  }
}

function handleLayerChange() {
  replaceTileLayer();
  const storedSelection = selectedSheets[layerSelect.value];
  if (storedSelection) {
    selectSheet(storedSelection, false);
  } else {
    selectedSheet = null;
    updateSelectedSheetDetails();
    renderSheetLayer();
  }
}

layerSelect.addEventListener("change", handleLayerChange);
sourceSelect.addEventListener("change", replaceTileLayer);
sheetIndexToggle.addEventListener("change", renderSheetLayer);

document.querySelector("#focus-sheet").addEventListener("click", () => {
  if (selectedSheet) {
    map.fitBounds(L.geoJSON(selectedSheet).getBounds(), { padding: [32, 32] });
  }
});

map.on("mousemove", (event) => {
  coordinateOutput.value = `${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
});

function boundsForFeature(feature) {
  const coordinates = feature.geometry.coordinates.flat(Infinity);
  const longitudes = coordinates.filter((value, index) => index % 2 === 0);
  const latitudes = coordinates.filter((value, index) => index % 2 === 1);
  return {
    west: Math.min(...longitudes),
    east: Math.max(...longitudes),
    south: Math.min(...latitudes),
    north: Math.max(...latitudes)
  };
}

function tileY(latitude, zoom) {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const mercatorY = Math.asinh(Math.tan(latitudeRadians));
  return ((1 - mercatorY / Math.PI) / 2) * 2 ** zoom;
}

function tileSourceUrl(layerName, zoom, x, y, tileSource) {
  const tmsRow = 2 ** zoom - 1 - y;
  if (tileSource === "offline") {
    return `${LOCAL_TILE_ROOT}/${layerName}/${zoom}/${x}/${tmsRow}.png`;
  }
  if (IS_GITHUB_PAGES) {
    return `${PDF_WORKER_BASE_URL}/${layerName}/${zoom}/${x}/${tmsRow}.png`;
  }
  return `/ngi-proxy/${layerName}/${zoom}/${x}/${tmsRow}.png`;
}

async function downloadTile(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Tile request failed (${response.status}) for ${url}`);
  }
  return createImageBitmap(await response.blob());
}

async function renderSheetCanvas(feature, layerName, tileSource, signal) {
  const bounds = boundsForFeature(feature);
  const zoom = NATIVE_ZOOM[layerName];
  const tileCountAtZoom = 2 ** zoom;
  const westTile = ((bounds.west + 180) / 360) * tileCountAtZoom;
  const eastTile = ((bounds.east + 180) / 360) * tileCountAtZoom;
  const northTile = tileY(bounds.north, zoom);
  const southTile = tileY(bounds.south, zoom);
  const firstX = Math.floor(westTile);
  const lastX = Math.ceil(eastTile) - 1;
  const firstY = Math.floor(northTile);
  const lastY = Math.ceil(southTile) - 1;
  const westPixel = westTile * TILE_SIZE;
  const northPixel = northTile * TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((eastTile - westTile) * TILE_SIZE);
  canvas.height = Math.ceil((southTile - northTile) * TILE_SIZE);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("This browser could not create a map image canvas.");
  }

  const coordinates = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      coordinates.push({ x, y });
    }
  }
  let completed = 0;
  let nextTile = 0;
  let tileError = null;
  const workers = Array.from({ length: 8 }, async () => {
    try {
      while (nextTile < coordinates.length) {
        if (signal.aborted) {
          throw new DOMException("PDF generation canceled.", "AbortError");
        }
        const { x, y } = coordinates[nextTile];
        nextTile += 1;
        const bitmap = await downloadTile(tileSourceUrl(layerName, zoom, x, y, tileSource), signal);
        context.drawImage(
          bitmap,
          x * TILE_SIZE - westPixel,
          y * TILE_SIZE - northPixel,
          TILE_SIZE,
          TILE_SIZE
        );
        bitmap.close();
        completed += 1;
        setStatus(`Preparing full-resolution map: loaded ${completed} of ${coordinates.length} tiles.`);
      }
    } catch (error) {
      if (!signal.aborted) {
        tileError = error;
        printController?.abort();
      }
      throw error;
    }
  });
  await Promise.allSettled(workers);
  if (tileError) {
    throw tileError;
  }
  if (signal.aborted) {
    throw new DOMException("PDF generation canceled.", "AbortError");
  }

  const jpeg = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode the full-resolution map image."));
      }
    }, "image/jpeg", 0.94);
  });
  const imageWidth = canvas.width;
  const imageHeight = canvas.height;
  canvas.width = 0;
  canvas.height = 0;
  return {
    jpeg: new Uint8Array(await jpeg.arrayBuffer()),
    imageWidth,
    imageHeight,
    bounds
  };
}

function mercatorY(latitude) {
  const latitudeRadians = (latitude * Math.PI) / 180;
  return EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));
}

function pdfEscape(value) {
  return value
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function mmToPt(value) {
  return (value * 72) / 25.4;
}

function makePdfContent({
  pageWidth,
  pageHeight,
  mapX,
  mapY,
  mapWidth,
  mapHeight,
  lines,
  scale,
  centerLatitude
}) {
  const commands = [];
  const text = (value, x, y, size, font = "F1") => {
    commands.push(
      `BT /${font} ${size.toFixed(2)} Tf ${mmToPt(x).toFixed(2)} ${mmToPt(pageHeight - y).toFixed(2)} Td (${pdfEscape(value)}) Tj ET`
    );
  };
  const line = (x1, y1, x2, y2, width = 0.3) => {
    commands.push(
      `${mmToPt(width).toFixed(2)} w ${mmToPt(x1).toFixed(2)} ${mmToPt(pageHeight - y1).toFixed(2)} m ${mmToPt(x2).toFixed(2)} ${mmToPt(pageHeight - y2).toFixed(2)} l S`
    );
  };

  text(lines.title, 16, 17, 18, "F2");
  text(lines.subtitle, 16, 25, 9);
  text(lines.extent, 16, 32, 7.5);
  text(
    `${lines.scaleText} at center latitude ${centerLatitude.toFixed(4)} degrees. Full-size print required.`,
    16,
    38,
    7.5
  );
  text(`Source raster zoom: ${lines.sourceZoom} (maximum available)`, 16, 44, 7);
  commands.push("q 0.25 w 0 0 0 RG");
  commands.push(
    `${mmToPt(mapWidth).toFixed(2)} 0 0 ${mmToPt(mapHeight).toFixed(2)} ${mmToPt(mapX).toFixed(2)} ${mmToPt(mapY).toFixed(2)} cm /Im0 Do Q`
  );
  commands.push("0.3 w 0 0 0 RG");
  commands.push(
    `${mmToPt(mapX).toFixed(2)} ${mmToPt(mapY).toFixed(2)} ${mmToPt(mapWidth).toFixed(2)} ${mmToPt(mapHeight).toFixed(2)} re S`
  );

  const scaleLengthKm = scale === 50000 ? 5 : 10;
  const scaleLengthMm = (scaleLengthKm * 1000000) / scale;
  const barX = 16;
  const barY = 50;
  const segment = scaleLengthMm / 2;
  commands.push(
    `0 0 0 rg ${mmToPt(barX).toFixed(2)} ${mmToPt(pageHeight - barY - 2).toFixed(2)} ${mmToPt(segment).toFixed(2)} ${mmToPt(2).toFixed(2)} re f`
  );
  commands.push(
    `1 1 1 rg ${mmToPt(barX + segment).toFixed(2)} ${mmToPt(pageHeight - barY - 2).toFixed(2)} ${mmToPt(segment).toFixed(2)} ${mmToPt(2).toFixed(2)} re f`
  );
  commands.push("0 0 0 RG");
  line(barX, barY - 1, barX + scaleLengthMm, barY - 1, 0.25);
  text("0", barX, barY + 3, 6);
  text(`${scaleLengthKm} km`, barX + scaleLengthMm - 13, barY + 3, 6);
  text("N", pageWidth - 19, barY + 1, 8, "F2");
  line(pageWidth - 16, barY - 1, pageWidth - 16, barY - 8, 0.5);
  line(pageWidth - 16, barY - 8, pageWidth - 18, barY - 5, 0.5);
  line(pageWidth - 16, barY - 8, pageWidth - 14, barY - 5, 0.5);

  const footerY = pageHeight - 22;
  line(16, footerY - 7, pageWidth - 16, footerY - 7, 0.25);
  text(lines.attribution, 16, footerY, 6.5);
  text(lines.source, 16, footerY + 5, 6.5);
  text(lines.safety, 16, footerY + 10, 6.5);
  text(lines.generated, pageWidth - 75, footerY, 6.5);

  return commands.join("\n");
}

function assemblePdf(jpegBytes, imageWidth, imageHeight, pageWidth, pageHeight, content) {
  const encoder = new TextEncoder();
  const objects = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mmToPt(pageWidth).toFixed(2)} ${mmToPt(pageHeight).toFixed(2)}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 7 0 R >>"
    ),
    null,
    encoder.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    encoder.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
    encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`)
  ];
  const imageHeader = encoder.encode(
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  const imageFooter = encoder.encode("\nendstream");
  const chunks = [encoder.encode("%PDF-1.4\n%TopoSearch\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const objectHeader = encoder.encode(`${index + 1} 0 obj\n`);
    const objectFooter = encoder.encode("\nendobj\n");
    if (index === 3) {
      chunks.push(objectHeader, imageHeader, jpegBytes, imageFooter, objectFooter);
      offset += objectHeader.length + imageHeader.length + jpegBytes.length + imageFooter.length + objectFooter.length;
    } else {
      chunks.push(objectHeader, object, objectFooter);
      offset += objectHeader.length + object.length + objectFooter.length;
    }
  });
  const xrefOffset = offset;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  offsets.slice(1).forEach((objectOffset) => {
    xref.push(`${objectOffset.toString().padStart(10, "0")} 00000 n `);
  });
  chunks.push(
    encoder.encode(
      `${xref.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
    )
  );
  return new Blob(chunks, { type: "application/pdf" });
}

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(5)} ${value >= 0 ? positive : negative}`;
}

function buildPrintLines(feature, layerName, tileSource, bounds) {
  const { s: sheet, e: edition, y: year } = feature.properties;
  const scale = MAP_SCALE[layerName];
  const scaleLabel = layerName === "50k" ? "50 000" : "250 000";
  const centerLatitude = (bounds.north + bounds.south) / 2;
  const source = tileSource === "online" ? "Online NGI tiles" : "Local offline tiles";
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  return {
    centerLatitude,
    scale,
    sourceZoom: NATIVE_ZOOM[layerName],
    title: `Sheet ${sheet}${sheetName(feature) ? ` - ${sheetName(feature)}` : ""}`,
    subtitle: `NGI 1:${scaleLabel} topographic map | Edition ${edition} (${year})`,
    extent:
      `Extent: ${formatCoordinate(bounds.west, "E", "W")} to ${formatCoordinate(bounds.east, "E", "W")}, ` +
      `${formatCoordinate(bounds.south, "N", "S")} to ${formatCoordinate(bounds.north, "N", "S")}`,
    scaleText: `Nominal scale 1:${scale.toLocaleString("en-US")}`,
    attribution: "State Copyright - Chief Directorate: National Geo-spatial Information (NGI).",
    source: `Tile source: ${source} | htonl.dev.openstreetmap.org/ngi-tiles/`,
    safety: "Verify map currency and local conditions before navigation.",
    generated: `Generated ${timestamp}`
  };
}

async function createPrintPdf(feature, layerName, tileSource, signal) {
  if (!feature) {
    throw new Error("Select a map sheet before printing.");
  }
  const { jpeg, imageWidth, imageHeight, bounds } = await renderSheetCanvas(
    feature,
    layerName,
    tileSource,
    signal
  );
  const lines = buildPrintLines(feature, layerName, tileSource, bounds);
  const centerLatitude = lines.centerLatitude;
  const cosLatitude = Math.cos((centerLatitude * Math.PI) / 180);
  const westMercator = EARTH_RADIUS_METERS * ((bounds.west * Math.PI) / 180);
  const eastMercator = EARTH_RADIUS_METERS * ((bounds.east * Math.PI) / 180);
  const northMercator = mercatorY(bounds.north);
  const southMercator = mercatorY(bounds.south);
  const mapWidth = ((eastMercator - westMercator) * cosLatitude * 1000) / lines.scale;
  const mapHeight = ((northMercator - southMercator) * cosLatitude * 1000) / lines.scale;
  const pageWidth = layerName === "50k" ? 594 : 1189;
  const pageHeight = 841;
  const mapX = (pageWidth - mapWidth) / 2;
  const mapY = pageHeight - 65 - mapHeight;
  if (mapX < 16 || mapY < 16) {
    throw new Error(`Sheet ${feature.properties.s} does not fit the selected print scale and page.`);
  }
  const content = makePdfContent({
    pageWidth,
    pageHeight,
    mapX,
    mapY,
    mapWidth,
    mapHeight,
    lines,
    scale: lines.scale,
    centerLatitude
  });
  return assemblePdf(jpeg, imageWidth, imageHeight, pageWidth, pageHeight, content);
}

printButton.addEventListener("click", async () => {
  if (printController || !selectedSheet) {
    return;
  }
  printController = new AbortController();
  printButton.disabled = true;
  cancelPrintButton.hidden = false;
  const feature = selectedSheet;
  const fileSheet = feature.properties.s;
  const fileLayer = layerSelect.value;
  const tileSource = sourceSelect.value;
  try {
    const pdf = await createPrintPdf(feature, fileLayer, tileSource, printController.signal);
    if (printController.signal.aborted) {
      return;
    }
    const url = URL.createObjectURL(pdf);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `TopoSearch_${fileSheet}_${fileLayer}_${new Date().toISOString().slice(0, 10)}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(`Downloaded full-resolution print PDF for sheet ${fileSheet}.`);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("PDF generation canceled.");
    } else {
      setStatus(`Could not create the print PDF: ${error.message}`, "error");
    }
  } finally {
    printController = null;
    cancelPrintButton.hidden = true;
    updateSelectedSheetDetails();
  }
});

cancelPrintButton.addEventListener("click", () => {
  if (printController) {
    printController.abort();
    setStatus("Canceling PDF generation…");
  }
});

replaceTileLayer();
loadSheetIndex();
if (IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL) {
  printButton.title = "Deploy the Cloudflare Worker and configure its URL to enable PDF downloads.";
}
