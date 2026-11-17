import { magvar, MODEL_EPOCH, MODEL_VALID_UNTIL } from "./vendor/magvar/magvar.js";
import { onQuotaChange, quotaRemaining, startGeneration } from "./auth.js";
import { decodeTileResponse } from "./tile-image.js";
import { PRINT_SCALE, paperLayout, frameGeometry, clampFrameCenter, mercatorY, rasterZoom } from "./print-layout.js";
import { createWayfinder } from "./wayfinder.js";
import { pdfEscape, wayfinderPdfCommands } from "./wayfinder-print.js";
import { a3PdfCommands } from "./a3-print.js";

const NGI_ROOT = "https://htonl.dev.openstreetmap.org/ngi-tiles";
const SATELLITE_ROOT = "https://aerial.openstreetmap.org.za/layer/ngi-aerial";
const SATELLITE_ZOOM = 15;
const copyrightYear = new Date().getFullYear();
const SATELLITE_ATTRIBUTION =
  `State Copyright &copy; ${copyrightYear} <a href="https://ngi.dlrrd.gov.za/">Chief Directorate: National Geo-spatial Information</a>`;
const LOCAL_TILE_ROOT = "./tiles";
const SHEET_INDEX_URLS = {
  "50k": "./data/sheets-50k.geojson",
  "250k": "./data/sheets-250k.geojson"
};
// Matches the Worker's allowed tile area (worker/index.js); PDFs outside it cannot be built on GitHub Pages.
const PDF_AREA = { west: 16, east: 33.5, south: -35, north: -22 };
const FULLMAPS_INDEX_URL = "./data/fullmaps-index.json";
const TARGET_SHEET = "3325CC";
const INITIAL_CENTER = [-33.875, 25.125];
const INITIAL_ZOOM = 10;
const TILE_SIZE = 256;
const NATIVE_ZOOM = { "50k": 15, "250k": 12 };
const PDF_WORKER_BASE_URL = "https://toposearch-ngi-proxy.jonathan-f66.workers.dev";
const IS_GITHUB_PAGES =
  window.location.hostname.endsWith(".github.io") && window.location.hostname !== "localhost";

const statusElement = document.querySelector("#map-status");
const layerSelect = document.querySelector("#map-layer");
const sourceSelect = document.querySelector("#tile-source");
const paperSelect = document.querySelector("#paper-size");
const sheetIndexToggle = document.querySelector("#sheet-index");
const coordinateOutput = document.querySelector("#coordinates");
const selectedSheetElement = document.querySelector("#selected-sheet");
const selectedSheetNameElement = document.querySelector("#selected-sheet-name");
const printButton = document.querySelector("#print-map");
const cancelPrintButton = document.querySelector("#cancel-print");
const legCancelPrintButton = document.querySelector("#wayfinder-cancel-print");
const raceMapButton = document.querySelector("#race-map");
const raceMapButtonLabel = document.querySelector("#race-map-label");
const raceMapButtonSize = document.querySelector("#race-map-size");
const raceWorldLink = document.querySelector("#race-map-world");
const clearFrameButton = document.querySelector("#clear-frame");
const blendSlider = document.querySelector("#map-blend");
const printChoice = document.querySelector("#print-choice");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarTools = document.querySelector("#sidebar-tools");

sidebarToggle.addEventListener("click", () => {
  sidebarTools.hidden = !sidebarTools.hidden;
  sidebarToggle.setAttribute("aria-expanded", String(!sidebarTools.hidden));
  sidebarToggle.textContent = sidebarTools.hidden ? "Show tools" : "Hide tools";
});
document.querySelectorAll("#sidebar-tools > details").forEach((section) => {
  section.addEventListener("toggle", () => {
    if (section.open) {
      document.querySelectorAll("#sidebar-tools > details").forEach((other) => {
        if (other !== section) other.open = false;
      });
    }
  });
});

const map = L.map("map", {
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  minZoom: 3,
  maxZoom: 20,
  zoomControl: true
});
const wayfinder = createWayfinder(map);

const attribution =
  'State Copyright &copy; Chief Directorate: National Geo-spatial Information (NGI)';
// NGI tiles exist only for South Africa; the rest of the world uses a faded neutral base map.
const NGI_COVERAGE = L.latLngBounds([-35.2, 16.2], [-21.9, 33.1]);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  maxNativeZoom: 19,
  opacity: 0.5,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

map.createPane("satellite");
map.getPane("satellite").style.zIndex = "210";
map.createPane("topographic");
map.getPane("topographic").style.zIndex = "220";
map.createPane("paper-preview");
map.getPane("paper-preview").style.zIndex = "450";
const satelliteLayer = L.tileLayer(`${SATELLITE_ROOT}/{z}/{x}/{y}.png`, {
  maxZoom: 20,
  maxNativeZoom: 20,
  bounds: NGI_COVERAGE,
  pane: "satellite",
  attribution: SATELLITE_ATTRIBUTION
});
satelliteLayer.on("tileerror", () => {
  setStatus("Aerial imagery could not be loaded. Please try again later.", "error");
});
document.querySelector("#aerial-copyright-year").textContent = copyrightYear;

let tileLayer;
let sheetLayer;
let sheetCollections = {};
let selectedSheet = null;
let tileErrors = 0;
let printController = null;
let printToken = null;
let fullMapsBase = "";
let freeFrame = null;
let frameCenter = null;
let frameLocked = false;
let lockedFrameUsable = true;
let frameRect = null;
let frameHandle = null;
let paperRect = null;
let paperMask = null;
let suppressFrameClick = false;
let suppressFrameClickTimer = null;
let pendingLegPrint = null;

document.addEventListener("toposearch:leg-view", (event) => {
  const frame = event.detail.leg?.frame;
  frameLocked = Boolean(frame);
  lockedFrameUsable = true;
  paperSelect.disabled = frameLocked;
  clearFrameButton.disabled = frameLocked;
  map.getContainer().classList.toggle("frame-locked", frameLocked);
  const position = frame ?? event.detail.leg?.draft ?? (event.detail.leg ? map.getCenter() : null);
  if (position) {
    const clamped = clampFrameCenter({ lat: position.lat, lng: position.lng }, "A3", downloadArea());
    if (frame && (Math.abs(clamped.lat - frame.lat) > 1e-8 || Math.abs(clamped.lng - frame.lng) > 1e-8)) {
      lockedFrameUsable = false;
      freeFrame = null;
      frameCenter = null;
      selectedSheet = null;
      renderFrame();
      renderSheetLayer();
      updateSelectedSheetDetails();
      setStatus("The locked frame is outside the downloadable area. Unlock it to select a new frame.", "error");
      return;
    }
    setFrameCenter(L.latLng(frame ?? clamped), { allowLocked: true });
  } else {
    freeFrame = null;
    frameCenter = null;
    selectedSheet = null;
    renderSheetLayer();
  }
  renderFrame();
  updateSelectedSheetDetails();
});

document.querySelector("#wayfinder-frame-toggle").addEventListener("click", () => {
  const leg = wayfinder.selectedLeg();
  if (!leg) return;
  if (leg.frame) {
    if (!window.confirm("Unlock this leg's map selection? Moving it changes both the Master and Blank maps and requires a new generation.")) return;
    wayfinder.setFrame(null);
    setStatus("Map selection unlocked. Drag the frame or click the map to reposition it.");
  } else if (!frameCenter || !freeFrame) {
    setStatus("Select a leg and position its map before locking.", "error");
  } else {
    wayfinder.setFrame({ id: crypto.randomUUID(), lat: frameCenter.lat, lng: frameCenter.lng, paperSize: paperSelect.value, layoutVersion: 2 });
  }
});

function activeTarget() {
  return freeFrame;
}

function setStatus(message, state = "info") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
  const legStatus = document.querySelector("#wayfinder-print-status");
  legStatus.textContent = message;
  legStatus.dataset.state = state;
}

function tileUrl(layerName) {
  const root = sourceSelect.value === "offline" ? LOCAL_TILE_ROOT : NGI_ROOT;
  return `${root}/tiles/${layerName}/{z}/{x}/{y}.png`;
}

function createTileLayer() {
  const layerName = layerSelect.value;
  return L.tileLayer(tileUrl(layerName), {
    tms: true,
    maxZoom: 20,
    maxNativeZoom: NATIVE_ZOOM[layerName],
    bounds: NGI_COVERAGE,
    pane: "topographic",
    attribution,
    opacity: 1 - Number(blendSlider.value) / 100
  });
}

blendSlider.addEventListener("input", () => {
  const blend = Number(blendSlider.value);
  if (blend > 0 && !map.hasLayer(satelliteLayer)) {
    satelliteLayer.addTo(map);
  } else if (blend === 0 && map.hasLayer(satelliteLayer)) {
    map.removeLayer(satelliteLayer);
  }
  tileLayer.setOpacity(1 - blend / 100);
  blendSlider.setAttribute("aria-valuetext", `${100 - blend}% topographic, ${blend}% aerial imagery`);
});

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

function isPdfAvailable(feature) {
  if (!IS_GITHUB_PAGES) {
    return true;
  }
  const { west, east, south, north } = boundsForFeature(feature);
  return west >= PDF_AREA.west && east <= PDF_AREA.east && south >= PDF_AREA.south && north <= PDF_AREA.north;
}

function styleSheet() {
  return { color: "#d14d2a", weight: 3, opacity: 1, fillColor: "#f0b27e", fillOpacity: 0.18 };
}

function formatMegabytes(bytes) {
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

function updateRaceMapButton() {
  const race = fullMapsBase ? selectedSheet?.properties.race : null;
  raceMapButton.hidden = !race;
  raceWorldLink.hidden = !race;
  if (!race) {
    return;
  }
  const url = `${fullMapsBase}/${encodeURIComponent(race.file)}`;
  raceMapButtonLabel.textContent = `Original race map ${selectedSheet.properties.s} (TIF)`;
  raceMapButton.href = url;
  raceMapButton.setAttribute("download", race.file);
  raceMapButton.title = `${race.file} · ${race.pixels.join(" × ")} px · edition ${race.edition} (${race.year})`;
  raceMapButtonSize.textContent = `(${formatMegabytes(race.bytes)})`;
  raceWorldLink.href = `${fullMapsBase}/${encodeURIComponent(race.world)}`;
}

function updateSelectedSheetDetails() {
  const target = activeTarget();
  wayfinder.setMapFrameAvailable(Boolean(target));
  map.getContainer().classList.toggle("frame-mode", Boolean(target));
  const legSelected = Boolean(wayfinder.selectedLeg());
  document.querySelector("#generic-print-hint").hidden = !legSelected;
  updateRaceMapButton();
  if (!target) {
    selectedSheetElement.textContent = "No frame";
    selectedSheetNameElement.textContent = "Add a leg to create a map";
    printButton.disabled = true;
    printButton.title = "";
    return;
  }
  if (target.properties.custom) {
    selectedSheetElement.textContent = "Free frame";
    const sheet = selectedSheet ? ` · ${selectedSheet.properties.s}` : "";
    selectedSheetNameElement.textContent = `${Math.abs(frameCenter.lat).toFixed(3)}° S, ${frameCenter.lng.toFixed(3)}° E${sheet}`;
  } else {
    selectedSheetElement.textContent = target.properties.s;
    selectedSheetNameElement.textContent = sheetName(target);
  }
  const pdfAvailable = isPdfAvailable(target);
  const outOfQuota = quotaRemaining() === 0;
  printButton.disabled =
    Boolean(printController) || legSelected || (IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL) || !pdfAvailable || outOfQuota;
  printButton.title = legSelected
    ? "Use the Master or Blank download in the selected leg."
    : !pdfAvailable
    ? "PDF export is not yet available for this area."
    : outOfQuota
      ? "You have used all of your map generations for this month."
      : "";
}

function renderSheetLayer() {
  if (sheetLayer) {
    map.removeLayer(sheetLayer);
    sheetLayer = null;
  }
  if (selectedSheet && sheetIndexToggle.checked) {
    sheetLayer = L.geoJSON(selectedSheet, { style: styleSheet, interactive: false }).addTo(map);
  }
}

function sheetAt(latlng) {
  const collection = sheetCollections["50k"];
  if (!collection) {
    return null;
  }
  let best = null;
  let bestArea = Infinity;
  for (const feature of collection.features) {
    const { west, east, south, north } = boundsForFeature(feature);
    const area = (east - west) * (north - south);
    if (latlng.lng >= west && latlng.lng <= east && latlng.lat >= south && latlng.lat <= north && area < bestArea) {
      best = feature;
      bestArea = area;
    }
  }
  return best;
}

map.on("click", (event) => {
  if (suppressFrameClick) {
    suppressFrameClick = false;
    return;
  }
  if (freeFrame) placeFrame(event.latlng);
});

function downloadArea() {
  return IS_GITHUB_PAGES ? PDF_AREA : { west: 16.2, east: 33.1, south: -35.2, north: -21.9 };
}

function frameFeature(center, size) {
  const { west, east, south, north } = frameGeometry(center, size).map;
  return {
    type: "Feature",
    properties: { s: "CUSTOM", custom: true, e: "", y: "", centerLat: center.lat, centerLng: center.lng },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [west, north], [east, north], [east, south], [west, south]]]
    }
  };
}

function leafletBounds({ west, east, south, north }) {
  return L.latLngBounds([south, west], [north, east]);
}

function setFrameCenter(center, { moveHandle = true, allowLocked = false } = {}) {
  if (frameLocked && !allowLocked) return;
  frameCenter = L.latLng(clampFrameCenter(center, paperSelect.value, downloadArea()));
  if (!frameLocked) wayfinder.setDraft(frameCenter);
  const geometry = frameGeometry(frameCenter, paperSelect.value);
  freeFrame = frameFeature(frameCenter, paperSelect.value);
  selectedSheet = sheetAt(frameCenter);
  frameRect?.setBounds(leafletBounds(geometry.map));
  paperRect?.setBounds(leafletBounds(geometry.paper));
  paperMask?.setLatLngs(paperMaskRings(geometry));
  if (moveHandle) {
    frameHandle?.setLatLng(frameCenter);
  }
  renderSheetLayer();
  updateSelectedSheetDetails();
  setStatus(
    `Free frame centred at ${Math.abs(frameCenter.lat).toFixed(4)}° S, ${frameCenter.lng.toFixed(4)}° E.${frameLocked ? " Locked for this leg." : " Drag it to adjust."}`
  );
}

function startFrameDrag(event) {
  L.DomEvent.stopPropagation(event);
  if (frameLocked) return;
  map.dragging.disable();
  const offsetLat = event.latlng.lat - frameCenter.lat;
  const offsetLng = event.latlng.lng - frameCenter.lng;
  const move = (moveEvent) =>
    setFrameCenter(L.latLng(moveEvent.latlng.lat - offsetLat, moveEvent.latlng.lng - offsetLng));
  const stop = () => {
    map.off("mousemove", move);
    document.removeEventListener("mouseup", stop);
    map.dragging.enable();
    suppressFrameClick = true;
    clearTimeout(suppressFrameClickTimer);
    suppressFrameClickTimer = setTimeout(() => {
      suppressFrameClick = false;
    }, 0);
  };
  map.on("mousemove", move);
  document.addEventListener("mouseup", stop);
}

function paperMaskRings({ paper, map: printed }) {
  const ring = ({ south, west, north, east }) =>
    [[south, west], [north, west], [north, east], [south, east]];
  return [ring(paper), ring(printed)];
}

function renderFrame() {
  frameRect?.remove();
  frameHandle?.remove();
  paperRect?.remove();
  paperMask?.remove();
  frameRect = null;
  frameHandle = null;
  paperRect = null;
  paperMask = null;
  if (!freeFrame) {
    return;
  }
  const geometry = frameGeometry(frameCenter, paperSelect.value);
  const frameColor = frameLocked ? "#b91c1c" : "#047857";
  paperMask = L.polygon(paperMaskRings(geometry), {
    pane: "paper-preview",
    stroke: false,
    fillColor: "#292524",
    fillOpacity: 0.18,
    interactive: false
  }).addTo(map);
  paperRect = L.rectangle(leafletBounds(geometry.paper), {
    pane: "paper-preview",
    color: frameColor,
    weight: 2,
    dashArray: "6 5",
    fill: false,
    bubblingMouseEvents: false,
    className: "free-frame",
    interactive: !frameLocked
  }).addTo(map);
  paperRect.on("mousedown", startFrameDrag);
  frameRect = L.rectangle(leafletBounds(geometry.map), {
    pane: "paper-preview",
    color: frameColor,
    weight: 3,
    fillColor: frameColor,
    fillOpacity: 0.03,
    bubblingMouseEvents: false,
    className: "free-frame",
    interactive: !frameLocked
  }).addTo(map);
  frameRect.on("mousedown", startFrameDrag);
  frameHandle = L.marker(frameCenter, {
    draggable: !frameLocked,
    keyboard: false,
    title: frameLocked ? "Frame locked for this leg" : "Drag to move the frame",
    icon: L.divIcon({ className: "frame-handle", html: "✥", iconSize: [34, 34], iconAnchor: [17, 17] })
  }).addTo(map);
  frameHandle.on("drag", () => setFrameCenter(frameHandle.getLatLng(), { moveHandle: false }));
  frameHandle.on("dragend", () => frameHandle.setLatLng(frameCenter));
}

function placeFrame(latlng) {
  if (frameLocked) return;
  const area = downloadArea();
  if (latlng.lat < area.south || latlng.lat > area.north || latlng.lng < area.west || latlng.lng > area.east) {
    setStatus("Free frames can only be placed inside the dashed downloadable area.", "error");
    return;
  }
  setFrameCenter(latlng);
  renderFrame();
  setStatus(
    `Free frame placed at ${Math.abs(frameCenter.lat).toFixed(4)}° S, ${frameCenter.lng.toFixed(4)}° E. Drag it to adjust.`
  );
}

clearFrameButton.addEventListener("click", () => {
  if (frameLocked) return;
  freeFrame = null;
  frameCenter = null;
  selectedSheet = null;
  renderFrame();
  renderSheetLayer();
  updateSelectedSheetDetails();
  setStatus("Map cleared. Select a leg to create its map.");
});

const area = downloadArea();
L.rectangle([[area.south, area.west], [area.north, area.east]], {
  color: "#597343",
  weight: 2,
  dashArray: "8 6",
  fill: false,
  interactive: false
}).addTo(map);
// Links each 50k sheet to its scanned original. Combined sheets are matched regardless of code order.
async function attachFullMaps(collection) {
  try {
    const response = await fetch(FULLMAPS_INDEX_URL);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const { downloadBase, maps } = await response.json();
    fullMapsBase = downloadBase;
    const normalize = (key) => key.split("_").sort().join("_");
    const byKey = new Map(collection.features.map((feature) => [normalize(feature.properties.s), feature]));
    for (const entry of maps) {
      const feature = byKey.get(normalize(entry.key));
      if (feature) {
        feature.properties.race = entry;
      }
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

    if (!sheetCollections["50k"].features.length) {
      throw new Error("No 1:50,000 map sheets are available.");
    }
    if (frameCenter) {
      selectedSheet = sheetAt(frameCenter);
      renderSheetLayer();
      updateSelectedSheetDetails();
    } else {
      setStatus(
        IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL
          ? "Deploy the Cloudflare Worker and configure its URL to enable PDF downloads."
          : "Open WayFinder and create a race to begin."
      );
    }
  } catch (error) {
    setStatus(`Could not load the local sheet index: ${error.message}`, "error");
  }
}

function handleLayerChange() {
  replaceTileLayer();
}

layerSelect.addEventListener("change", handleLayerChange);
paperSelect.addEventListener("change", () => {
  if (freeFrame) {
    setFrameCenter(frameCenter);
    renderFrame();
  }
});
sourceSelect.addEventListener("change", replaceTileLayer);
sheetIndexToggle.addEventListener("change", renderSheetLayer);

document.querySelector("#focus-sheet").addEventListener("click", () => {
  const target = activeTarget();
  if (target) {
    map.fitBounds(leafletBounds(frameGeometry(frameCenter, paperSelect.value).paper), { padding: [32, 32] });
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

function tileSourceUrl(layerName, zoom, x, y, tileSource, imagery) {
  if (imagery === "satellite") {
    return `${SATELLITE_ROOT}/${zoom}/${x}/${y}.png`;
  }
  const tmsRow = 2 ** zoom - 1 - y;
  if (tileSource === "offline") {
    return `${LOCAL_TILE_ROOT}/${layerName}/${zoom}/${x}/${tmsRow}.png`;
  }
  if (IS_GITHUB_PAGES) {
    return `${PDF_WORKER_BASE_URL}/${layerName}/${zoom}/${x}/${tmsRow}.png`;
  }
  return `/ngi-proxy/${layerName}/${zoom}/${x}/${tmsRow}.png`;
}

async function downloadTile(url, signal, imagery) {
  const headers = printToken && url.startsWith(PDF_WORKER_BASE_URL) ? { Authorization: `Bearer ${printToken}` } : undefined;
  const response = await fetch(url, { signal, headers });
  return decodeTileResponse(response, url, imagery === "satellite");
}

async function renderSheetCanvas(feature, layerName, tileSource, signal, imagery) {
  const bounds = boundsForFeature(feature);
  const zoom = rasterZoom(bounds, imagery === "satellite" ? SATELLITE_ZOOM : NATIVE_ZOOM[layerName]);
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
  if (imagery === "satellite") {
    context.fillStyle = "#e7e5e4";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const coordinates = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      coordinates.push({ x, y });
    }
  }
  let completed = 0;
  let missingTiles = 0;
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
        const bitmap = await downloadTile(tileSourceUrl(layerName, zoom, x, y, tileSource, imagery), signal, imagery);
        if (bitmap) {
          context.drawImage(
            bitmap,
            x * TILE_SIZE - westPixel,
            y * TILE_SIZE - northPixel,
            TILE_SIZE,
            TILE_SIZE
          );
          bitmap.close();
        } else {
          missingTiles += 1;
        }
        completed += 1;
        setStatus(`Preparing ${imagery === "satellite" ? "aerial" : imagery} map: loaded ${completed} of ${coordinates.length} tiles.`);
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
  if (missingTiles === coordinates.length) {
    throw new Error("No aerial imagery is available for the selected area.");
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
    bounds,
    missingTiles,
    zoom
  };
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
  layerName,
  compact,
  paperSize,
  markings,
  leg,
  race
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
  const markerTextContext = document.createElement("canvas").getContext("2d");
  if (!markerTextContext) {
    throw new Error("This browser could not measure marker labels for the PDF.");
  }
  const measureMarkerText = (value, size) => {
    markerTextContext.font = `bold ${size}pt Arial, sans-serif`;
    return markerTextContext.measureText(value).width * 72 / 96;
  };
  if (paperSize === "A3") {
    return a3PdfCommands({
      layout: { pageHeight, mapX, mapY, mapWidth, mapHeight },
      lines, scale, markings, leg, race,
      measureText: (value, size, font) => {
        markerTextContext.font = `${font === "F2" ? "bold " : ""}${size}pt Arial, sans-serif`;
        return markerTextContext.measureText(value).width * 72 / 96;
      }
    });
  }
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

  if (compact) {
    const margin = 10;
    text("TOPOSEARCH | FREE FRAME", margin, 10, 7, "F2");
    text(`${paperSize} | 1:50 000 | Print at 100% / actual size`, margin, 17, 7, "F2");
    text(lines.satellite ? "NGI aerial imagery" : lines.sourceLabel, margin, 23, 6);
    const barX = pageWidth - 57;
    rectangle(barX, 7, 20, 1.8, "0 0 0", "0 0 0", 0.2);
    rectangle(barX + 20, 7, 20, 1.8, "0 0 0", "1 1 1", 0.2);
    text("0", barX, 14, 5);
    centeredText("1", barX + 20, 14, 5);
    text("2 km", barX + 40, 14, 5);
    commands.push("q 0.25 w 0 0 0 RG");
    commands.push(
      `${mmToPt(mapWidth).toFixed(2)} 0 0 ${mmToPt(mapHeight).toFixed(2)} ${mmToPt(mapX).toFixed(2)} ${mmToPt(pageHeight - mapY - mapHeight).toFixed(2)} cm /Im0 Do Q`
    );
    commands.push(wayfinderPdfCommands(markings, lines.bounds, { pageHeight, mapX, mapY, mapWidth, mapHeight }, measureMarkerText));
    rectangle(mapX, mapY, mapWidth, mapHeight, "0 0 0", null, 0.35);
    const footer = mapY + mapHeight + 5;
    text(`True north up | Magnetic declination ${lines.declinationLabel} (${lines.declinationModel})`, margin, footer, 5.5);
    if (lines.satellite) {
      text(lines.missingTiles ? "Grey areas: no aerial imagery available." : "Aerial imagery dates vary by location.", margin, footer + 6, 5.5);
      text("Imagery is for reference; verify routes and local conditions.", margin, footer + 12, 5.5);
    } else {
      const entries = [
        ["Road", "0.72 0.12 0.08", "[] 0 d"],
        ["Track", "0.42 0.38 0.32", "[1 1] 0 d"],
        ["Water", "0.12 0.42 0.72", "[] 0 d"],
        ["Boundary", "0 0 0", "[2 2] 0 d"],
        ["Railway", "0.1 0.1 0.1", "[] 0 d"],
        ["Vegetation", "0.18 0.55 0.24", "[1 1] 0 d"]
      ];
      const columnWidth = (pageWidth - 2 * margin) / 3;
      entries.forEach(([label, color, dash], index) => {
        const x = margin + (index % 3) * columnWidth;
        const y = footer + 6 + Math.floor(index / 3) * 5;
        line(x, y - 1, x + 7, y - 1, 0.5, color, dash);
        text(label, x + 9, y, 5.5);
      });
    }
    text(lines.extent, margin, footer + 19, 5);
    text(`${lines.source} | Raster zoom ${lines.sourceZoom}`, margin, footer + 25, 5);
    text(lines.attribution, margin, footer + 31, 5);
    text(lines.generated, margin, footer + 37, 5);
    text(lines.satellite ? "Check image dates and local conditions before navigation." : "Symbols are generalized; check source symbology and local conditions.", margin, footer + 43, 5);
    return commands.join("\n");
  }

  const margin = 14;
  text(lines.scaleHeader, margin, 19, 10, "F2");
  text(lines.satellite ? "SOUTH AFRICA | AERIAL" : "SOUTH AFRICA | TOPOGRAPHIC", margin, 27, 6.5);
  centeredText(lines.title.toUpperCase(), pageWidth / 2, 24, 17, "F2");
  rectangle(pageWidth - 93, 9, 79, 22, "0.25 0.25 0.25");
  text(lines.headerSheet, pageWidth - 89, 17, 7, "F2");
  text(lines.headerEdition, pageWidth - 89, 25, 6.5);
  line(margin, 39, pageWidth - margin, 39, 0.35);

  commands.push("q 0.25 w 0 0 0 RG");
  commands.push(
    `${mmToPt(mapWidth).toFixed(2)} 0 0 ${mmToPt(mapHeight).toFixed(2)} ${mmToPt(mapX).toFixed(2)} ${mmToPt(pageHeight - mapY - mapHeight).toFixed(2)} cm /Im0 Do Q`
  );
  commands.push(wayfinderPdfCommands(markings, lines.bounds, { pageHeight, mapX, mapY, mapWidth, mapHeight }, measureMarkerText));
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
    const seconds = Math.round(Math.abs(value) * 3600);
    const degrees = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    return `${degrees} ${String(minutes).padStart(2, "0")} ${String(seconds % 60).padStart(2, "0")} ${value >= 0 ? positive : negative}`;
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
  if (lines.satellite) {
    centeredText("NGI AERIAL IMAGERY", pageWidth / 2, legendTop + 7, 8, "F2");
    centeredText("Imagery dates and coverage vary; PDF detail is limited by the export resolution.", pageWidth / 2, legendTop + 16, 7);
    centeredText("Image is for reference only. Verify routes and conditions on the ground.", pageWidth / 2, legendTop + 23, 7);
    if (lines.missingTiles) {
      centeredText("Grey areas indicate missing aerial imagery.", pageWidth / 2, legendTop + 30, 7);
    }
  } else {
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
  }

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
  // Custom frames rarely align with the sheet grid, so draw true sheet outlines around the frame.
  const drawCustomIndex = () => {
    const pad = 0.25;
    const frame = lines.bounds;
    const region = {
      west: frame.west - pad,
      east: frame.east + pad,
      south: frame.south - pad,
      north: frame.north + pad
    };
    const areaX = indexX + 2;
    const areaY = indexY + 7;
    const areaWidth = indexWidth - 4;
    const areaHeight = 34;
    const toX = (longitude) => areaX + ((longitude - region.west) / (region.east - region.west)) * areaWidth;
    const toY = (latitude) => areaY + ((region.north - latitude) / (region.north - region.south)) * areaHeight;
    rectangle(areaX, areaY, areaWidth, areaHeight, "0.35 0.35 0.35", "1 1 1", 0.2);
    rectangle(
      toX(frame.west),
      toY(frame.north),
      toX(frame.east) - toX(frame.west),
      toY(frame.south) - toY(frame.north),
      "0.72 0.12 0.08",
      "0.96 0.88 0.78",
      0.5
    );
    sheetIndexFeatures.forEach((feature) => {
      const box = boundsForFeature(feature);
      const west = Math.max(box.west, region.west);
      const east = Math.min(box.east, region.east);
      const south = Math.max(box.south, region.south);
      const north = Math.min(box.north, region.north);
      if (east - west < 1e-6 || north - south < 1e-6) {
        return;
      }
      rectangle(toX(west), toY(north), toX(east) - toX(west), toY(south) - toY(north), "0.5 0.5 0.5", null, 0.15);
      const centerLongitude = (box.west + box.east) / 2;
      const centerLatitude = (box.south + box.north) / 2;
      if (
        centerLongitude >= region.west && centerLongitude <= region.east &&
        centerLatitude >= region.south && centerLatitude <= region.north
      ) {
        centeredText(feature.properties.s, toX(centerLongitude), toY(centerLatitude) + 1.5, layerName === "50k" ? 4.6 : 3.2);
      }
    });
    rectangle(
      toX(frame.west),
      toY(frame.north),
      toX(frame.east) - toX(frame.west),
      toY(frame.south) - toY(frame.north),
      "0.72 0.12 0.08",
      null,
      0.6
    );
  };
  if (lines.custom) {
    drawCustomIndex();
  } else {
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
  }

  const detailX = pageWidth - margin - 211;
  const detailY = detailsTop + 8;
  const detailLines = [
    lines.subtitle,
    lines.extent,
    `${lines.source} | Raster zoom ${lines.sourceZoom}`,
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

function assemblePdf(jpegBytes, imageWidth, imageHeight, pageWidth, pageHeight, content, logoBytes = null) {
  const encoder = new TextEncoder();
  const objects = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mmToPt(pageWidth).toFixed(2)} ${mmToPt(pageHeight).toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 4 0 R${logoBytes ? " /Im1 8 0 R" : ""} >> /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << /WF << /Type /ExtGState /ca 0.45 /CA 0.45 >> >> >> /Contents 7 0 R >>`
    ),
    null,
    encoder.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    encoder.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`)
  ];
  if (logoBytes) objects.push(null);
  const imageHeader = (bytes, width, height) => encoder.encode(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`
  );
  const imageFooter = encoder.encode("\nendstream");
  const chunks = [encoder.encode("%PDF-1.4\n%TopoSearch\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const objectHeader = encoder.encode(`${index + 1} 0 obj\n`);
    const objectFooter = encoder.encode("\nendobj\n");
    if (index === 3 || index === 7) {
      const bytes = index === 3 ? jpegBytes : logoBytes;
      const header = imageHeader(bytes, index === 3 ? imageWidth : 600, index === 3 ? imageHeight : 236);
      chunks.push(objectHeader, header, bytes, imageFooter, objectFooter);
      offset += objectHeader.length + header.length + bytes.length + imageFooter.length + objectFooter.length;
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

function overlappingSheets(bounds) {
  return (sheetCollections["50k"]?.features || []).filter((feature) => {
    const other = boundsForFeature(feature);
    return (
      other.east - bounds.west > 1e-6 &&
      bounds.east - other.west > 1e-6 &&
      other.north - bounds.south > 1e-6 &&
      bounds.north - other.south > 1e-6
    );
  });
}

function coverageLabel(bounds) {
  const codes = overlappingSheets(bounds).map((feature) => feature.properties.s);
  if (!codes.length) {
    return "Sheets: n/a";
  }
  const shown = codes.slice(0, 8).join(", ");
  return `Sheets: ${shown}${codes.length > 8 ? ` +${codes.length - 8} more` : ""}`;
}

function buildPrintLines(feature, layerName, tileSource, bounds, generatedAt, imagery, missingTiles, sourceZoom) {
  const { s: sheet, e: edition, y: year, custom } = feature.properties;
  const scale = PRINT_SCALE;
  const scaleLabel = "50 000";
  const centerLatitude = feature.properties.centerLat;
  const centerLongitude = feature.properties.centerLng;
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
  const satellite = imagery === "satellite";
  return {
    centerLatitude,
    scale,
    sourceZoom,
    satellite,
    missingTiles,
    custom,
    headerSheet: custom ? "CUSTOM FRAME" : `SHEET ${sheet}`,
    headerEdition: satellite ? "AERIAL | DATE VARIES" : custom ? "EDITION PER SOURCE SHEET" : `EDITION ${edition} | ${year}`,
    title: custom ? "Custom map frame" : `${sheet}${sheetName(feature) ? ` - ${sheetName(feature)}` : ""}`,
    subtitle: satellite
      ? `NGI aerial imagery | ${custom ? "Custom frame" : `Sheet ${sheet}`}`
      : custom
      ? `NGI 1:${layerName === "50k" ? "50 000" : "250 000"} source${layerName === "250k" ? " (enlarged)" : ""} | ${coverageLabel(bounds)}`
      : `NGI source map | Edition ${edition} (${year})`,
    sourceLabel: `NGI 1:${layerName === "50k" ? "50 000" : "250 000"} topographic source${layerName === "250k" ? " (enlarged)" : ""}`,
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
    attribution: satellite ? `State Copyright © ${generatedAt.getFullYear()} Chief Directorate: National Geo-spatial Information` : "State Copyright - Chief Directorate: National Geo-spatial Information (NGI).",
    source: satellite ? "Tile source: aerial.openstreetmap.org.za" : `Tile source: ${source} | htonl.dev.openstreetmap.org/ngi-tiles/`,
    legendNote: satellite ? "Aerial image capture dates vary by location; verify currency." : "Reference symbols are generalized; check source-edition symbology.",
    safety: "Verify map currency and local conditions before navigation.",
    generated: `Generated ${timestamp}`
  };
}

async function createPrintPdf(feature, layerName, tileSource, signal, imagery, paperSize, markings, leg, race, logoBytes) {
  if (!feature) {
    throw new Error("Select a map sheet before printing.");
  }
  const { jpeg, imageWidth, imageHeight, bounds, missingTiles, zoom } = await renderSheetCanvas(
    feature,
    layerName,
    tileSource,
    signal,
    imagery
  );
  const generatedAt = new Date();
  const lines = buildPrintLines(feature, layerName, tileSource, bounds, generatedAt, imagery, missingTiles, zoom);
  const { pageWidth, pageHeight, mapX, mapY, mapWidth, mapHeight, compact } = paperLayout(paperSize);
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
    layerName,
    compact,
    paperSize,
    markings,
    leg,
    race
  });
  return { pdf: assemblePdf(jpeg, imageWidth, imageHeight, pageWidth, pageHeight, content, logoBytes), missingTiles };
}

function openPrintChoice(variant = null) {
  const leg = wayfinder.selectedLeg();
  if (!variant && leg) {
    setStatus("Use the Master or Blank download in the selected leg.", "error");
    return;
  }
  if (variant && (!leg?.frame || !lockedFrameUsable || !activeTarget())) {
    setStatus("Lock a valid map selection for this leg before downloading.", "error");
    return;
  }
  if (variant && wayfinder.raceForLeg(leg.id)?.distanceKm === undefined) {
    setStatus("Add the race distance in Edit race details before downloading.", "error");
    return;
  }
  if (!printController && activeTarget()) {
    pendingLegPrint = variant ? { legId: leg.id, lockId: leg.frame.id, variant } : null;
    document.querySelector("#print-quota-note").textContent = pendingLegPrint
      ? "The first download uses one generation, even if canceled or unsuccessful. Existing locks use a new generation for the updated A3 layout. Matching Master and Blank downloads are free while the frame and imagery settings stay unchanged."
      : "Each PDF uses one map generation, even if canceled or unsuccessful.";
    printChoice.returnValue = "";
    printChoice.showModal();
  }
}
printButton.addEventListener("click", () => openPrintChoice());
document.querySelector("#wayfinder-download-master").addEventListener("click", () => openPrintChoice("master"));
document.querySelector("#wayfinder-download-blank").addEventListener("click", () => openPrintChoice("blank"));

printChoice.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const imagery = event.submitter?.value;
  printChoice.close();
  if (imagery !== "topographic" && imagery !== "satellite") {
    return;
  }
  const feature = activeTarget();
  const legPrint = pendingLegPrint;
  pendingLegPrint = null;
  if (printController || !feature) {
    return;
  }
  printController = new AbortController();
  printButton.disabled = true;
  cancelPrintButton.hidden = false;
  legCancelPrintButton.hidden = !legPrint;
  const fileSheet = feature.properties.custom
    ? `FreeFrame_${Math.abs(frameCenter.lat).toFixed(3)}S_${frameCenter.lng.toFixed(3)}E`
    : feature.properties.s;
  const fileLayer = layerSelect.value;
  const tileSource = sourceSelect.value;
  const paperSize = paperSelect.value;
  try {
    let markings;
    let legPair;
    let printLeg = null;
    let printRace = null;
    let legFileName = "";
    if (legPrint) {
      const leg = wayfinder.selectedLeg();
      if (!leg?.frame || leg.id !== legPrint.legId || leg.frame.id !== legPrint.lockId || !lockedFrameUsable) {
        throw new Error("The leg or its locked frame changed. Select it again before downloading.");
      }
      markings = wayfinder.legSnapshot(leg.id, legPrint.variant === "blank");
      legFileName = leg.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "Leg";
      await wayfinder.ensureSaved();
      if (printController.signal.aborted) {
        throw new DOMException("PDF generation canceled.", "AbortError");
      }
      const current = wayfinder.selectedLeg();
      if (!current?.frame || current.id !== legPrint.legId || current.frame.id !== legPrint.lockId) {
        throw new Error("The leg or its locked frame changed while saving. Select it again before downloading.");
      }
      const race = wayfinder.raceForLeg(current.id);
      if (race?.distanceKm === undefined) throw new Error("Add the race distance before downloading.");
      printLeg = structuredClone(current);
      printRace = structuredClone(race);
      legPair = { legId: leg.id, lockId: leg.frame.id, layer: fileLayer, source: tileSource, imagery };
    } else {
      markings = wayfinder.snapshot();
    }
    let logoBytes = null;
    if (paperSize === "A3") {
      const response = await fetch("./assets/race-template-logo.jpg", { signal: printController.signal });
      if (!response.ok) throw new Error("The A3 template logo could not be loaded.");
      logoBytes = new Uint8Array(await response.arrayBuffer());
    }
    printToken = await startGeneration(legPair);
    const { pdf, missingTiles } = await createPrintPdf(feature, fileLayer, tileSource, printController.signal, imagery, paperSize, markings, printLeg, printRace, logoBytes);
    if (printController.signal.aborted) {
      return;
    }
    const url = URL.createObjectURL(pdf);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `TopoSearch_${fileSheet}_${paperSize}_1-50000_${fileLayer}${imagery === "satellite" ? "_Aerial" : ""}${legPrint ? `_${legFileName}_${legPrint.variant}` : ""}_${new Date().toISOString().slice(0, 10)}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const missingNote = missingTiles ? ` ${missingTiles} tiles have no aerial imagery and are shown in grey.` : "";
    setStatus(`Downloaded ${imagery === "satellite" ? "aerial" : imagery} print PDF for ${feature.properties.custom ? "the free frame" : `sheet ${fileSheet}`}.${missingNote}`);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("PDF generation canceled.");
    } else {
      setStatus(`Could not create the print PDF: ${error.message}`, "error");
    }
  } finally {
    printController = null;
    printToken = null;
    cancelPrintButton.hidden = true;
    legCancelPrintButton.hidden = true;
    updateSelectedSheetDetails();
  }
});

function cancelPrint() {
  if (printController) {
    printController.abort();
    setStatus("Canceling PDF generation…");
  }
}
cancelPrintButton.addEventListener("click", cancelPrint);
legCancelPrintButton.addEventListener("click", cancelPrint);

replaceTileLayer();
loadSheetIndex();
onQuotaChange(() => updateSelectedSheetDetails());
document.addEventListener("toposearch:signed-in", () => {
  map.invalidateSize();
  updateSelectedSheetDetails();
});
if (IS_GITHUB_PAGES && !PDF_WORKER_BASE_URL) {
  printButton.title = "Deploy the Cloudflare Worker and configure its URL to enable PDF downloads.";
}
