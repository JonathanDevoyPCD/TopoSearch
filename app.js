import { magvar, MODEL_EPOCH, MODEL_VALID_UNTIL } from "./vendor/magvar/magvar.js";

const NGI_ROOT = "https://htonl.dev.openstreetmap.org/ngi-tiles";
const LOCAL_TILE_ROOT = "./tiles";
const SHEET_INDEX_URLS = {
  "50k": "./data/loerie-sheets.geojson",
  "250k": "./data/loerie-250k-sheets.geojson"
};
const FULLMAPS_INDEX_URL = "./data/fullmaps-index.json";
const TARGET_SHEET = "3325CC";
const INITIAL_CENTER = [-33.875, 25.125];
const INITIAL_ZOOM = 10;
const TILE_SIZE = 256;
const EARTH_RADIUS_METERS = 6378137;
const NATIVE_ZOOM = { "50k": 15, "250k": 12 };
const MAP_SCALE = { "50k": 50000, "250k": 250000 };
const PDF_WORKER_BASE_URL = "https://toposearch-ngi-proxy.jonathan-f66.workers.dev";
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
const raceMapButton = document.querySelector("#race-map");
const raceMapButtonSize = document.querySelector("#race-map-size");
const raceWorldLink = document.querySelector("#race-map-world");

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
let fullMapsBase = "";

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

function formatMegabytes(bytes) {
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

function updateRaceMapButton() {
  const race = layerSelect.value === "50k" && fullMapsBase ? selectedSheet?.properties.race : null;
  raceMapButton.hidden = !race;
  raceWorldLink.hidden = !race;
  if (!race) {
    return;
  }
  const url = `${fullMapsBase}/${encodeURIComponent(race.file)}`;
  raceMapButton.href = url;
  raceMapButton.setAttribute("download", race.file);
  raceMapButton.title = `${race.file} · ${race.pixels.join(" × ")} px · edition ${race.edition} (${race.year})`;
  raceMapButtonSize.textContent = `(${formatMegabytes(race.bytes)})`;
  raceWorldLink.href = `${fullMapsBase}/${encodeURIComponent(race.world)}`;
}

function updateSelectedSheetDetails() {
  if (!selectedSheet) {
    selectedSheetElement.textContent = "No sheet";
    selectedSheetNameElement.textContent = "";
    printButton.disabled = true;
    updateRaceMapButton();
    return;
  }
  updateRaceMapButton();
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

// Links each 50k sheet to its scanned original and adds any scanned sheets missing from the index.
async function attachFullMaps(collection) {
  try {
    const response = await fetch(FULLMAPS_INDEX_URL);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const { downloadBase, maps } = await response.json();
    fullMapsBase = downloadBase;
    const byKey = new Map(collection.features.map((feature) => [feature.properties.s, feature]));
    for (const entry of maps) {
      let feature = byKey.get(entry.key);
      if (!feature) {
        const { west, east, south, north } = entry.bounds;
        feature = {
          type: "Feature",
          properties: { s: entry.key, y: entry.year, e: entry.edition },
          geometry: {
            type: "Polygon",
            coordinates: [[[west, south], [west, north], [east, north], [east, south], [west, south]]]
          }
        };
        collection.features.push(feature);
      }
      feature.properties.race = entry;
    }
  } catch (error) {
    console.warn(`Race map index unavailable: ${error.message}`);
  }
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
    await attachFullMaps(sheetCollections["50k"]);

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
  sheetIndexFeatures,
  selectedFeature,
  layerName
}) {
  const commands = [];
  const text = (value, x, y, size, font = "F1", color = "0 0 0") => {
    commands.push(
      `${color} rg BT /${font} ${size.toFixed(2)} Tf ${mmToPt(x).toFixed(2)} ${mmToPt(pageHeight - y).toFixed(2)} Td (${pdfEscape(value)}) Tj ET`
    );
  };
  const textWidth = (value, size) => value.length * size * 0.176;
  const centeredText = (value, centerX, y, size, font = "F1", color = "0 0 0") => {
    text(value, centerX - textWidth(value, size) / 2, y, size, font, color);
  };
  const line = (x1, y1, x2, y2, width = 0.3, color = "0 0 0", dash = "[] 0 d") => {
    commands.push(
      `${dash} ${color} RG ${mmToPt(width).toFixed(2)} w ${mmToPt(x1).toFixed(2)} ${mmToPt(pageHeight - y1).toFixed(2)} m ${mmToPt(x2).toFixed(2)} ${mmToPt(pageHeight - y2).toFixed(2)} l S`
    );
  };
  const rectangle = (x, y, width, height, stroke = "0 0 0", fill = null, strokeWidth = 0.25) => {
    const path =
      `${mmToPt(x).toFixed(2)} ${mmToPt(pageHeight - y - height).toFixed(2)} ` +
      `${mmToPt(width).toFixed(2)} ${mmToPt(height).toFixed(2)} re`;
    if (fill) {
      commands.push(`${fill} rg ${path} f`);
    }
    commands.push(`${stroke} RG ${mmToPt(strokeWidth).toFixed(2)} w ${path} S`);
  };

  const margin = 14;
  text(lines.scaleHeader, margin, 19, 10, "F2");
  text("SOUTH AFRICA | TOPOGRAPHIC", margin, 27, 6.5);
  centeredText(lines.title.toUpperCase(), pageWidth / 2, 24, 17, "F2");
  rectangle(pageWidth - 93, 9, 79, 22, "0.25 0.25 0.25");
  text(`SHEET ${lines.sheet}`, pageWidth - 89, 17, 7, "F2");
  text(`EDITION ${lines.edition} | ${lines.year}`, pageWidth - 89, 25, 6.5);
  line(margin, 39, pageWidth - margin, 39, 0.35);

  commands.push("q 0.25 w 0 0 0 RG");
  commands.push(
    `${mmToPt(mapWidth).toFixed(2)} 0 0 ${mmToPt(mapHeight).toFixed(2)} ${mmToPt(mapX).toFixed(2)} ${mmToPt(pageHeight - mapY - mapHeight).toFixed(2)} cm /Im0 Do Q`
  );
  rectangle(mapX, mapY, mapWidth, mapHeight, "0 0 0", null, 0.4);

  const coordinateTicks = (min, max, interval) => {
    const values = [min];
    for (
      let value = Math.ceil(min / interval - 1e-8) * interval;
      value < max - 1e-8;
      value += interval
    ) {
      if (value > min + 1e-8) {
        values.push(value);
      }
    }
    if (max - values[values.length - 1] > 1e-8) {
      values.push(max);
    }
    return values;
  };
  const axisLabel = (value, positive, negative) => {
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute + 1e-8);
    const minutes = Math.round((absolute - degrees) * 60);
    return `${degrees} ${String(minutes).padStart(2, "0")} ${value >= 0 ? positive : negative}`;
  };
  const longitudeInterval = (lines.bounds.east - lines.bounds.west) > 1 ? 0.5 : 5 / 60;
  const latitudeInterval = (lines.bounds.north - lines.bounds.south) > 1 ? 0.25 : 5 / 60;
  coordinateTicks(lines.bounds.west, lines.bounds.east, longitudeInterval).forEach((longitude) => {
    const x = mapX + ((longitude - lines.bounds.west) / (lines.bounds.east - lines.bounds.west)) * mapWidth;
    line(x, mapY, x, mapY - 3, 0.2);
    line(x, mapY + mapHeight, x, mapY + mapHeight + 3, 0.2);
    centeredText(axisLabel(longitude, "E", "W"), x, mapY - 5, 5.5);
    centeredText(axisLabel(longitude, "E", "W"), x, mapY + mapHeight + 9, 5.5);
  });
  const northMercator = mercatorY(lines.bounds.north);
  const southMercator = mercatorY(lines.bounds.south);
  coordinateTicks(lines.bounds.south, lines.bounds.north, latitudeInterval).forEach((latitude) => {
    const y = mapY + ((northMercator - mercatorY(latitude)) / (northMercator - southMercator)) * mapHeight;
    line(mapX, y, mapX - 3, y, 0.2);
    line(mapX + mapWidth, y, mapX + mapWidth + 3, y, 0.2);
    const label = axisLabel(latitude, "N", "S");
    text(label, mapX - textWidth(label, 5.5) - 5, y + 1.8, 5.5);
    text(label, mapX + mapWidth + 5, y + 1.8, 5.5);
  });

  const compassWidth = Math.min(86, mapX - 24);
  const compassX = (mapX - compassWidth) / 2;
  const compassY = mapY + mapHeight / 2 - 34;
  rectangle(compassX, compassY, compassWidth, 68, "0.35 0.35 0.35", "0.98 0.98 0.96");
  centeredText("NORTH REFERENCE", mapX / 2, compassY + 7, 6, "F2");
  const arrowCenterX = mapX / 2;
  const arrowCenterY = compassY + 37;
  const arrowLength = Math.min(18, compassWidth * 0.23);
  const declinationRadians = (lines.declination * Math.PI) / 180;
  const drawArrow = (angle, color, label) => {
    const tipX = arrowCenterX + Math.sin(angle) * arrowLength;
    const tipY = arrowCenterY - Math.cos(angle) * arrowLength;
    line(arrowCenterX, arrowCenterY, tipX, tipY, 0.7, color);
    line(
      tipX,
      tipY,
      tipX - Math.sin(angle - 2.55) * 3,
      tipY + Math.cos(angle - 2.55) * 3,
      0.7,
      color
    );
    line(
      tipX,
      tipY,
      tipX - Math.sin(angle + 2.55) * 3,
      tipY + Math.cos(angle + 2.55) * 3,
      0.7,
      color
    );
    text(label, tipX - 2, tipY - 2, 5.5, "F2", color);
  };
  drawArrow(0, "0 0 0", "T/G");
  drawArrow(declinationRadians, "0.72 0.12 0.08", "M");
  centeredText(lines.declinationLabel, mapX / 2, compassY + 52, 5.5);
  centeredText("True / grid and magnetic north", mapX / 2, compassY + 60, 5);

  const legendTop = mapY + mapHeight + 14;
  line(margin, legendTop, pageWidth - margin, legendTop, 0.35);
  centeredText("REFERENCE / VERKLARING", pageWidth / 2, legendTop + 7, 8, "F2");
  const legendColumns = [
    [
      ["International boundaries", "Internasionale grense", "boundary", "0 0 0"],
      ["Provincial boundaries", "Provinsiale grense", "boundary", "0.25 0.25 0.25"],
      ["Multiple track railways", "Veelvuldige spoorlyne", "rail", "0.1 0.1 0.1"],
      ["Single track railways", "Enkelspoorlyne", "rail", "0.1 0.1 0.1"],
      ["Electrified railways", "Geelektrifiseerde spoorlyne", "rail", "0.15 0.15 0.15"],
      ["Narrow gauge railways", "Smalspoorlyne", "rail", "0.2 0.2 0.2"],
      ["Service and mineral railways", "Diens- en mineraalspoorlyne", "rail", "0.25 0.25 0.25"],
      ["National roads", "Nasionale paaie", "road", "0.72 0.12 0.08"],
      ["Main roads", "Hoofpaaie", "road", "0.78 0.25 0.12"],
      ["Secondary roads", "Sekondere paaie", "road", "0.82 0.45 0.18"],
      ["Other roads", "Ander paaie", "road", "0.35 0.3 0.25"],
      ["Tracks and footpaths", "Dowwe paaie en voetpaaie", "dotted", "0.42 0.38 0.32"],
      ["Power lines", "Kraglyne", "line", "0.2 0.2 0.2"],
      ["Telephone and telegraph lines", "Telefoon- en telegraaflyne", "dotted", "0.25 0.25 0.25"],
      ["Public services and buildings", "Openbare dienste en geboue", "point", "0.18 0.18 0.18"],
      ["Lighthouses and marine lights", "Vuurtorings en seevaartligte", "point", "0.72 0.12 0.08"],
      ["Marine and trig beacons", "Seevaart- en driehoeksbakens", "point", "0.18 0.18 0.18"]
    ],
    [
      ["Magnetic stations and ground signs", "Magnetiese stasies en grondtekens", "point", "0.18 0.18 0.18"],
      ["Monuments", "Monumente", "point", "0.18 0.18 0.18"],
      ["Dipping tanks and windmills", "Dipbakke en windpompe", "point", "0.2 0.2 0.2"],
      ["Stone and anti-erosion walls", "Klip- en grondbewaringswalle", "line", "0.4 0.32 0.22"],
      ["Excavations", "Uitgrawings", "dotted", "0.5 0.34 0.2"],
      ["Perennial water", "Standhoudende water", "water", "0.12 0.42 0.72"],
      ["Non-perennial water", "Nie-standhoudende water", "dotted", "0.12 0.42 0.72"],
      ["Dry pans", "Droe panne", "dotted", "0.36 0.57 0.7"],
      ["Springs, fountains and wells", "Fonteine, watergate en putte", "point", "0.12 0.42 0.72"],
      ["Marshes, swamps and vleis", "Moerasse en vleie", "water", "0.12 0.48 0.66"],
      ["Pipelines", "Pyplyne", "dashed", "0.12 0.42 0.72"],
      ["Prominent rock outcrops", "Uitstaande klipbanke", "dotted", "0.62 0.38 0.16"],
      ["Terraces", "Terrasse", "dotted", "0.72 0.45 0.12"],
      ["Cultivated lands", "Bewerkte lande", "dotted", "0.18 0.55 0.24"],
      ["Orchards and vineyards", "Boorde en wingerde", "dotted", "0.18 0.55 0.24"],
      ["Trees and bush", "Bome en bos", "dotted", "0.12 0.42 0.2"]
    ]
  ];
  const columnGap = 14;
  const columnWidth = (pageWidth - 2 * margin - columnGap) / 2;
  const rowStart = legendTop + 15;
  const rowHeight = 4.15;
  legendColumns.forEach((entries, columnIndex) => {
    const x = margin + columnIndex * (columnWidth + columnGap);
    entries.forEach(([english, afrikaans, kind, color], rowIndex) => {
      const y = rowStart + rowIndex * rowHeight;
      text(english, x + 2, y, 6);
      const symbolX = x + columnWidth * 0.54;
      const symbolWidth = 16;
      if (kind === "rail") {
        line(symbolX, y - 1.6, symbolX + symbolWidth, y - 1.6, 0.45, color);
        line(symbolX, y - 0.4, symbolX + symbolWidth, y - 0.4, 0.45, color);
        for (let tick = 1; tick < 8; tick += 1) {
          const tickX = symbolX + (symbolWidth * tick) / 8;
          line(tickX, y - 1.8, tickX, y - 0.2, 0.25, color);
        }
      } else if (kind === "point") {
        line(symbolX + 5, y - 1.1, symbolX + 11, y - 1.1, 0.6, color);
        line(symbolX + 8, y - 2.7, symbolX + 8, y + 0.5, 0.6, color);
        line(symbolX + 6.8, y - 2.3, symbolX + 9.2, y + 0.1, 0.35, color);
      } else {
        const dash = kind === "boundary" || kind === "dotted"
          ? "[1 1] 0 d"
          : kind === "dashed"
            ? "[3 2] 0 d"
            : "[] 0 d";
        line(symbolX, y - 1, symbolX + symbolWidth, y - 1, kind === "road" ? 0.9 : 0.55, color, dash);
        if (kind === "water" || kind === "road") {
          line(symbolX, y + 0.1, symbolX + symbolWidth, y + 0.1, 0.25, color);
        }
      }
      text(afrikaans, symbolX + symbolWidth + 3, y, 6);
    });
  });
  const dividerX = margin + columnWidth + columnGap / 2;
  line(dividerX, legendTop + 10, dividerX, legendTop + 88, 0.2, "0.65 0.65 0.65");

  const detailsTop = legendTop + 94;
  line(margin, detailsTop, pageWidth - margin, detailsTop, 0.35);
  text("SCALE / SKAAL", margin + 2, detailsTop + 8, 6.5, "F2");
  text(`1:${scale.toLocaleString("en-US")}`, margin + 2, detailsTop + 16, 8, "F2");
  text("Print at 100% / actual size.", margin + 2, detailsTop + 25, 5.7);
  text("Do not use 'fit to page'.", margin + 2, detailsTop + 32, 5.7);
  const scaleLengthKm = scale === 50000 ? 5 : 20;
  const scaleSegments = scale === 50000 ? 5 : 4;
  const scaleLengthMm = (scaleLengthKm * 1000000) / scale;
  const barX = margin + 2;
  const barY = detailsTop + 47;
  const segmentWidth = scaleLengthMm / scaleSegments;
  const distancePerSegment = scaleLengthKm / scaleSegments;
  for (let segmentIndex = 0; segmentIndex < scaleSegments; segmentIndex += 1) {
    rectangle(
      barX + segmentIndex * segmentWidth,
      barY,
      segmentWidth,
      2.2,
      "0 0 0",
      segmentIndex % 2 === 0 ? "0 0 0" : "1 1 1",
      0.2
    );
    if (segmentIndex + 1 < scaleSegments) {
      centeredText(
        `${(segmentIndex + 1) * distancePerSegment}`,
        barX + (segmentIndex + 1) * segmentWidth,
        barY + 7,
        5
      );
    }
  }
  text("0", barX - 1, barY + 7, 5);
  text(`${scaleLengthKm} km`, barX + scaleLengthMm + 2, barY + 7, 5);

  const indexWidth = Math.min(128, pageWidth * 0.23);
  const indexX = (pageWidth - indexWidth) / 2;
  const indexY = detailsTop + 6;
  text("INDEX TO SHEETS / INDEKS VAN VELLE", indexX, indexY + 2, 5.8, "F2");
  const cellSize = 0.25;
  const gridColumns = layerName === "50k"
    ? 3
    : Math.max(1, Math.round((lines.bounds.east - lines.bounds.west) / cellSize));
  const gridRows = layerName === "50k"
    ? 3
    : Math.max(1, Math.round((lines.bounds.north - lines.bounds.south) / cellSize));
  const gridWidth = indexWidth - 4;
  const gridHeight = 34;
  const cellWidth = gridWidth / gridColumns;
  const cellHeight = gridHeight / gridRows;
  let gridWest;
  let gridNorth;
  if (layerName === "50k") {
    const selectedBounds = boundsForFeature(selectedFeature);
    const centerLongitude = (selectedBounds.west + selectedBounds.east) / 2;
    const centerLatitude = (selectedBounds.south + selectedBounds.north) / 2;
    gridWest = centerLongitude - (gridColumns * cellSize) / 2;
    gridNorth = centerLatitude + (gridRows * cellSize) / 2;
  } else {
    gridWest = lines.bounds.west;
    gridNorth = lines.bounds.north;
  }
  const gridX = indexX + 2;
  const gridY = indexY + 7;
  for (let row = 0; row < gridRows; row += 1) {
    for (let column = 0; column < gridColumns; column += 1) {
      rectangle(
        gridX + column * cellWidth,
        gridY + row * cellHeight,
        cellWidth,
        cellHeight,
        "0.35 0.35 0.35",
        "1 1 1",
        0.2
      );
    }
  }
  sheetIndexFeatures.forEach((feature) => {
    const featureBounds = boundsForFeature(feature);
    const centerLongitude = (featureBounds.west + featureBounds.east) / 2;
    const centerLatitude = (featureBounds.south + featureBounds.north) / 2;
    const column = Math.floor((centerLongitude - gridWest) / cellSize);
    const row = Math.floor((gridNorth - centerLatitude) / cellSize);
    if (column < 0 || column >= gridColumns || row < 0 || row >= gridRows) {
      return;
    }
    const x = gridX + column * cellWidth;
    const y = gridY + row * cellHeight;
    const isSelected = layerName === "50k" && feature.properties.s === lines.sheet;
    if (isSelected) {
      rectangle(x, y, cellWidth, cellHeight, "0.72 0.12 0.08", "0.96 0.88 0.78", 0.5);
    }
    centeredText(
      feature.properties.s,
      x + cellWidth / 2,
      y + cellHeight / 2 + (layerName === "50k" ? 1.7 : 1.3),
      layerName === "50k" ? 5 : 3.8,
      isSelected ? "F2" : "F1"
    );
  });
  if (layerName === "250k") {
    rectangle(gridX, gridY, gridWidth, gridHeight, "0.72 0.12 0.08", null, 0.55);
    centeredText(lines.sheet, gridX + gridWidth / 2, gridY + gridHeight + 6, 5.5, "F2");
  }

  const detailX = pageWidth - margin - 211;
  const detailY = detailsTop + 8;
  const detailLines = [
    lines.subtitle,
    lines.extent,
    `${lines.source} | Native raster zoom ${lines.sourceZoom}`,
    "Coordinate frame: WGS84 latitude / longitude | Image projection: Web Mercator",
    `Magnetic declination: ${lines.declinationLabel} (${lines.declinationModel})`,
    lines.attribution,
    lines.generated
  ];
  detailLines.forEach((value, index) => {
    text(value, detailX, detailY + index * 8, 5.8);
  });
  text(lines.legendNote, detailX, detailY + detailLines.length * 8, 5.8);
  text(lines.safety, detailX, detailY + (detailLines.length + 1) * 8, 5.8);

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

function buildPrintLines(feature, layerName, tileSource, bounds, generatedAt) {
  const { s: sheet, e: edition, y: year } = feature.properties;
  const scale = MAP_SCALE[layerName];
  const scaleLabel = layerName === "50k" ? "50 000" : "250 000";
  const centerLatitude = (bounds.north + bounds.south) / 2;
  const centerLongitude = (bounds.west + bounds.east) / 2;
  if (
    generatedAt.getUTCFullYear() < MODEL_EPOCH ||
    generatedAt.getUTCFullYear() >= MODEL_VALID_UNTIL
  ) {
    throw new Error(
      `Magnetic declination requires a supported WMM2025 date from ${MODEL_EPOCH} through ${MODEL_VALID_UNTIL - 1}.`
    );
  }
  const declination = magvar(centerLatitude, centerLongitude, 0, generatedAt);
  const declinationDirection = declination >= 0 ? "E" : "W";
  const source = tileSource === "online" ? "Online NGI tiles" : "Local offline tiles";
  const timestamp = generatedAt.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  return {
    centerLatitude,
    scale,
    sourceZoom: NATIVE_ZOOM[layerName],
    title: `${sheet}${sheetName(feature) ? ` - ${sheetName(feature)}` : ""}`,
    subtitle: `NGI 1:${scaleLabel} topographic map | Edition ${edition} (${year})`,
    extent:
      `Extent: ${formatCoordinate(bounds.west, "E", "W")} to ${formatCoordinate(bounds.east, "E", "W")}, ` +
      `${formatCoordinate(bounds.south, "N", "S")} to ${formatCoordinate(bounds.north, "N", "S")}`,
    bounds,
    sheet,
    edition,
    year,
    scaleHeader: `1:${scaleLabel}`,
    declination,
    declinationLabel: `${Math.abs(declination).toFixed(2)} degrees ${declinationDirection}`,
    declinationModel: `WMM2025 ${generatedAt.toISOString().slice(0, 10)}`,
    attribution: "State Copyright - Chief Directorate: National Geo-spatial Information (NGI).",
    source: `Tile source: ${source} | htonl.dev.openstreetmap.org/ngi-tiles/`,
    legendNote: "Reference symbols are generalized; check source-edition symbology.",
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
  const generatedAt = new Date();
  const lines = buildPrintLines(feature, layerName, tileSource, bounds, generatedAt);
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
  const mapY = 62;
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
    sheetIndexFeatures: sheetCollections["50k"]?.features || [],
    selectedFeature: feature,
    layerName
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
