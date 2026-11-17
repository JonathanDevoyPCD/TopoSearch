import { authEnabled, wayfinderRequest } from "./auth.js";
import {
  WAYFINDER_COLORS, WAYFINDER_POINT_TYPES, validWayfinderName, validWayfinderDescription,
  validateWayfinderMarkings, wayfinderMarkerColor
} from "./wayfinder-data.js";

export function createWayfinder(map) {
  const mercatorWorldWidth = 2 * Math.PI * 6378137;
  const toggle = document.querySelector("#wayfinder-toggle");
  const panel = document.querySelector("#wayfinder-panel");
  const tools = document.querySelector("#wayfinder-tools");
  const color = document.querySelector("#wayfinder-color");
  const hint = document.querySelector("#wayfinder-hint");
  const saveStatus = document.querySelector("#wayfinder-save-status");
  const retry = document.querySelector("#wayfinder-retry");
  const list = document.querySelector("#wayfinder-list");
  const count = document.querySelector("#wayfinder-count");
  const dialog = document.querySelector("#wayfinder-name-dialog");
  const form = document.querySelector("#wayfinder-name-form");
  const nameInput = document.querySelector("#wayfinder-name");
  const markerDetails = document.querySelector("#wayfinder-marker-details");
  const descriptionInput = document.querySelector("#wayfinder-description");
  const markerColorInput = document.querySelector("#wayfinder-marker-color");
  const nameError = document.querySelector("#wayfinder-name-error");
  const container = map.getContainer();
  const layers = L.layerGroup().addTo(map);
  map.createPane("wayfinder");
  map.getPane("wayfinder").style.zIndex = "460";

  let markings = [];
  let mode = "pan";
  let movingId = null;
  let revision = 0;
  let generation = 0;
  let savedGeneration = 0;
  let saving = false;
  let ready = !authEnabled;
  let epoch = 0;
  let timer = null;
  let retryAction = null;
  let pendingName = null;
  let stroke = null;
  let draftLayer = null;
  let consumeClick = false;

  function setSaveStatus(message, error = false, action = null) {
    saveStatus.textContent = message;
    saveStatus.dataset.error = String(error);
    toggle.textContent = error ? "WayFinder - Attention" : message.startsWith("Unsaved") || message === "Saving…"
      ? "WayFinder - Saving" : "WayFinder";
    toggle.title = message;
    retryAction = action;
    retry.hidden = !action;
    retry.textContent = action === load ? "Retry loading" : action === resolveConflict ? "Resolve conflict" : "Retry saving";
  }

  function setReady(value) {
    ready = value;
    tools.querySelectorAll("button").forEach((button) => {
      button.disabled = !ready && button.dataset.wayfinderTool !== "pan";
    });
  }

  function setMode(value, id = null) {
    mode = value;
    movingId = id;
    tools.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.wayfinderTool === value));
    });
    container.classList.toggle("wayfinder-drawing", value !== "pan");
    const messages = {
      pan: "Choose a tool, then mark the map.",
      cp: "Click the map to add a checkpoint.",
      ta: "Click the map to add a transition area.",
      start: "Click the map to add a start.",
      finish: "Click the map to add a finish.",
      label: "Click the map to add a label.",
      highlight: "Drag over the map to highlight an area. Zoom in for a narrower stroke.",
      move: "Click the map to move the selected marking."
    };
    hint.textContent = messages[value];
  }

  function draw() {
    layers.clearLayers();
    const ordered = [...markings.filter((marking) => marking.type === "highlight"),
      ...markings.filter((marking) => marking.type !== "highlight")];
    for (const marking of ordered) {
      if (marking.type === "highlight") {
        L.polyline(marking.points, {
          pane: "wayfinder", color: WAYFINDER_COLORS[marking.color], opacity: 0.45,
          weight: marking.width * 256 * 2 ** map.getZoom() / mercatorWorldWidth, interactive: false
        }).addTo(layers);
        continue;
      }
      if (marking.type !== "label") {
        L.circleMarker([marking.lat, marking.lng], {
          pane: "wayfinder", radius: 11, color: wayfinderMarkerColor(marking), weight: 2.5,
          fill: false, interactive: false
        }).addTo(layers);
      }
      const label = document.createElement("span");
      label.className = "wayfinder-label";
      const isMarker = marking.type === "cp" || marking.type === "ta";
      if (isMarker) {
        label.classList.add("wayfinder-marker-label");
        label.style.color = wayfinderMarkerColor(marking);
        const name = document.createElement("span");
        name.className = "wayfinder-marker-name";
        name.textContent = marking.name;
        const description = document.createElement("span");
        description.className = "wayfinder-marker-description";
        description.textContent = marking.description ?? "";
        label.append(name, description);
      } else {
        label.textContent = marking.name;
      }
      L.marker([marking.lat, marking.lng], {
        pane: "wayfinder", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", html: label, iconSize: [0, 0],
          iconAnchor: isMarker ? [0, -15] : marking.type === "label" ? [0, 8] : [-15, 8] })
      }).addTo(layers);
    }
  }

  function renderList() {
    count.textContent = String(markings.length);
    list.replaceChildren();
    for (const marking of markings) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = marking.type === "highlight" ? `${marking.color} highlight` : marking.name;
      item.append(title);
      const button = (label, action) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.setAttribute("aria-label", `${label} ${title.textContent}`);
        element.addEventListener("click", action);
        item.append(element);
      };
      button("Move", () => setMode("move", marking.id));
      if (marking.type !== "highlight") {
        const isMarker = marking.type === "cp" || marking.type === "ta";
        button(isMarker ? "Edit" : "Rename", () => nameMarking(marking, (details) => {
          const current = markings.find((entry) => entry.id === marking.id);
          if (current) {
            Object.assign(current, details);
            changed();
          }
        }));
      }
      button("Delete", () => {
        markings = markings.filter((entry) => entry.id !== marking.id);
        if (movingId === marking.id) {
          setMode("pan");
        }
        changed();
      });
      list.append(item);
    }
  }

  function scheduleSave() {
    if (!authEnabled) {
      setSaveStatus("Local preview only: markings are lost when this page closes or refreshes.");
      return;
    }
    setSaveStatus("Unsaved changes. Saving…");
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  }

  function changed() {
    generation += 1;
    draw();
    renderList();
    scheduleSave();
  }

  async function save() {
    if (saving || generation === savedGeneration || !ready) {
      return;
    }
    const currentEpoch = epoch;
    const currentGeneration = generation;
    const snapshot = structuredClone(markings);
    saving = true;
    try {
      const result = await wayfinderRequest("POST", { revision, markings: snapshot });
      if (currentEpoch !== epoch) {
        return;
      }
      revision = result.revision;
      savedGeneration = currentGeneration;
      if (generation === savedGeneration) {
        setSaveStatus("Saved to your account.");
      } else {
        scheduleSave();
      }
    } catch (error) {
      if (currentEpoch === epoch) {
        const message = error.status === 409
          ? "Not saved: changed on another device. Resolve the conflict or reload and discard these changes."
          : `Not saved: ${error.message}`;
        setSaveStatus(message, true, error.status === 409 ? resolveConflict : save);
      }
    } finally {
      if (currentEpoch === epoch) {
        saving = false;
      }
    }
  }

  async function resolveConflict() {
    if (!window.confirm("Replace all saved WayFinder markings with this device's version? Changes made on the other device will be lost.")) {
      return;
    }
    const currentEpoch = epoch;
    try {
      const current = await wayfinderRequest();
      if (currentEpoch !== epoch) {
        return;
      }
      if (!Number.isSafeInteger(current.revision) || current.revision < 0 ||
          !validateWayfinderMarkings(current.markings)) {
        throw new Error("The saved markings are invalid.");
      }
      revision = current.revision;
      setSaveStatus("Saving…");
      await save();
    } catch (error) {
      if (currentEpoch === epoch) {
        setSaveStatus(`Could not resolve conflict: ${error.message}`, true, resolveConflict);
      }
    }
  }

  async function load() {
    const currentEpoch = ++epoch;
    clearTimeout(timer);
    saving = false;
    setReady(false);
    setMode("pan");
    setSaveStatus("Loading saved markings…");
    try {
      const result = await wayfinderRequest();
      if (currentEpoch !== epoch) {
        return;
      }
      if (!Number.isSafeInteger(result.revision) || result.revision < 0 ||
          !validateWayfinderMarkings(result.markings)) {
        throw new Error("The saved markings are invalid.");
      }
      markings = result.markings;
      revision = result.revision;
      generation = 0;
      savedGeneration = 0;
      draw();
      renderList();
      setReady(true);
      setSaveStatus("Saved to your account.");
    } catch (error) {
      if (currentEpoch === epoch) {
        setSaveStatus(`Could not load WayFinder: ${error.message}`, true, load);
      }
    }
  }

  function nameMarking(marking, callback) {
    pendingName = callback;
    nameInput.value = marking.name;
    const isMarker = marking.type === "cp" || marking.type === "ta";
    markerDetails.hidden = !isMarker;
    descriptionInput.value = isMarker ? marking.description ?? "" : "";
    markerColorInput.value = isMarker ? wayfinderMarkerColor(marking) : "#000000";
    nameError.hidden = true;
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!validWayfinderName(name)) {
      nameError.textContent = "Enter 1–80 Latin letters, numbers or printable punctuation.";
      nameError.hidden = false;
      return;
    }
    const details = { name };
    if (!markerDetails.hidden) {
      const description = descriptionInput.value.trim();
      if (!validWayfinderDescription(description)) {
        nameError.textContent = "The description must use up to 80 Latin letters, numbers or printable punctuation.";
        nameError.hidden = false;
        return;
      }
      details.description = description;
      details.color = markerColorInput.value;
    }
    const callback = pendingName;
    pendingName = null;
    dialog.close();
    callback?.(details);
  });
  document.querySelector("#wayfinder-name-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { pendingName = null; });

  function nextName(type) {
    if (type !== "cp" && type !== "ta") {
      return type === "start" ? "Start" : type === "finish" ? "Finish" : "";
    }
    const prefix = type.toUpperCase();
    const used = markings.filter((marking) => marking.type === type)
      .map((marking) => new RegExp(`^${prefix}(\\d+)$`, "i").exec(marking.name))
      .filter(Boolean).map((match) => Number(match[1]));
    return `${prefix}${Math.max(0, ...used) + 1}`;
  }

  function add(marking) {
    const next = [...markings, marking];
    if (!validateWayfinderMarkings(next)) {
      setSaveStatus("WayFinder limit reached. Delete markings or shorten a highlight.", true);
      return;
    }
    markings = next;
    changed();
  }

  function place(latlng) {
    if (mode === "move") {
      const marking = markings.find((entry) => entry.id === movingId);
      if (!marking) {
        setMode("pan");
        return;
      }
      const next = structuredClone(marking);
      if (next.type === "highlight") {
        const first = map.project(L.latLng(next.points[0]), 0);
        const destination = map.project(latlng, 0);
        next.points = next.points.map((point) => {
          const moved = map.unproject(map.project(L.latLng(point), 0).add(destination.subtract(first)), 0);
          return [moved.lat, moved.lng];
        });
      } else {
        next.lat = latlng.lat;
        next.lng = latlng.lng;
      }
      const updated = markings.map((entry) => entry.id === next.id ? next : entry);
      if (!validateWayfinderMarkings(updated)) {
        setSaveStatus("The marking cannot be moved to that location.", true);
        return;
      }
      markings = updated;
      setMode("pan");
      changed();
    } else if (WAYFINDER_POINT_TYPES.includes(mode)) {
      const type = mode;
      nameMarking({ type, name: nextName(type) }, (details) => add({
        id: crypto.randomUUID(), type, ...details, lat: latlng.lat, lng: latlng.lng
      }));
    }
  }

  function isMapControl(target) {
    return target instanceof Element && Boolean(target.closest(".leaflet-control"));
  }

  container.addEventListener("pointerdown", (event) => {
    if (!ready || mode === "pan" || isMapControl(event.target) || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    consumeClick = true;
    container.setPointerCapture(event.pointerId);
    const point = map.mouseEventToLatLng(event);
    if (mode === "highlight") {
      stroke = {
        pointerId: event.pointerId, points: [[point.lat, point.lng]], last: [event.clientX, event.clientY],
        color: color.value, width: 12 * mercatorWorldWidth / (256 * 2 ** map.getZoom())
      };
      draftLayer = L.polyline(stroke.points, {
        pane: "wayfinder", color: WAYFINDER_COLORS[stroke.color], opacity: 0.45, weight: 12, interactive: false
      }).addTo(map);
    } else {
      stroke = { pointerId: event.pointerId, placement: point };
    }
  }, true);

  container.addEventListener("pointermove", (event) => {
    if (!stroke || stroke.pointerId !== event.pointerId || !stroke.points) {
      return;
    }
    if (Math.hypot(event.clientX - stroke.last[0], event.clientY - stroke.last[1]) < 2) {
      return;
    }
    const point = map.mouseEventToLatLng(event);
    stroke.points.push([point.lat, point.lng]);
    stroke.last = [event.clientX, event.clientY];
    draftLayer.setLatLngs(stroke.points);
  }, true);

  function finishPointer(event, canceled = false) {
    if (!stroke || stroke.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const finished = stroke;
    stroke = null;
    draftLayer?.remove();
    draftLayer = null;
    if (canceled) {
      consumeClick = false;
      return;
    }
    setTimeout(() => { consumeClick = false; }, 0);
    if (finished.points) {
      if (finished.points.length >= 2) {
        add({ id: crypto.randomUUID(), type: "highlight", color: finished.color, width: finished.width, points: finished.points });
      } else {
        hint.textContent = "Drag across the map to draw a highlight.";
      }
    } else {
      place(finished.placement);
    }
  }
  container.addEventListener("pointerup", (event) => finishPointer(event), true);
  container.addEventListener("pointercancel", (event) => finishPointer(event, true), true);
  for (const type of ["mousedown", "click", "touchstart"]) {
    container.addEventListener(type, (event) => {
      if (!isMapControl(event.target) && ((ready && mode !== "pan") || (type === "click" && consumeClick))) {
        event.preventDefault();
        event.stopPropagation();
        if (type === "click") {
          consumeClick = false;
        }
      }
    }, { capture: true, passive: false });
  }

  tools.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wayfinder-tool]");
    if (button && !button.disabled) {
      setMode(button.dataset.wayfinderTool);
    }
  });
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open) {
      setMode("pan");
    }
  }
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  document.querySelector("#wayfinder-close").addEventListener("click", () => setOpen(false));
  retry.addEventListener("click", () => retryAction?.());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.open && mode !== "pan") {
      setMode("pan");
    }
  });
  document.addEventListener("toposearch:signed-in", load);
  map.on("zoomend", draw);
  document.addEventListener("toposearch:signing-out", (event) => {
    if (generation !== savedGeneration &&
        !window.confirm("WayFinder has unsaved changes. Log out and discard them?")) {
      event.preventDefault();
    }
  });
  document.addEventListener("toposearch:signed-out", () => {
    epoch += 1;
    clearTimeout(timer);
    saving = false;
    markings = [];
    generation = 0;
    savedGeneration = 0;
    if (dialog.open) {
      dialog.close();
    }
    setReady(false);
    setMode("pan");
    draw();
    renderList();
  });
  window.addEventListener("beforeunload", (event) => {
    if ((authEnabled && generation !== savedGeneration) || (!authEnabled && markings.length)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  setReady(ready);
  renderList();
  if (!authEnabled) {
    setSaveStatus("Local preview only: markings are lost when this page closes or refreshes.");
  }
  return { snapshot: () => structuredClone(markings) };
}
