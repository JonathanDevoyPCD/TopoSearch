import { authEnabled, wayfinderRequest } from "./auth.js";
import {
  WAYFINDER_COLORS, WAYFINDER_LABEL_POSITIONS, WAYFINDER_MAX_LEGS, WAYFINDER_MAX_RACES, WAYFINDER_POINT_TYPES,
  WAYFINDER_PEN_THICKNESSES_MM,
  validWayfinderName, validWayfinderDescription, validRaceDistance, validateWayfinderData, validateWayfinderMarkings,
  visibleWayfinderMarkings, legWayfinderMarkings, wayfinderMarkerColor, migrateWayfinderData
} from "./wayfinder-data.js";
import { wayfinderPenDash } from "./wayfinder-print.js";
import { frameGeometry } from "./print-layout.js";

export function createWayfinder(map) {
  const mercatorWorldWidth = 2 * Math.PI * 6378137;
  const toggle = document.querySelector("#wayfinder-toggle");
  const section = document.querySelector("#wayfinder");
  const viewSelect = document.querySelector("#wayfinder-view");
  const home = document.querySelector("#wayfinder-home");
  const raceScreen = document.querySelector("#wayfinder-race");
  const mapsScreen = document.querySelector("#wayfinder-maps");
  const raceList = document.querySelector("#wayfinder-race-list");
  const raceDialog = document.querySelector("#wayfinder-race-dialog");
  const raceForm = document.querySelector("#wayfinder-race-form");
  const raceInput = document.querySelector("#wayfinder-race-input");
  const raceDistance = document.querySelector("#wayfinder-race-distance");
  const raceError = document.querySelector("#wayfinder-race-error");
  const editor = document.querySelector("#wayfinder-editor");
  const editorTitle = document.querySelector("#wayfinder-editor-title");
  const legList = document.querySelector("#wayfinder-leg-list");
  const legMapControls = document.querySelector("#wayfinder-leg-map-controls");
  const frameToggle = document.querySelector("#wayfinder-frame-toggle");
  const frameToggleText = document.querySelector("#wayfinder-frame-toggle-text");
  const unlockedIcon = document.querySelector("#wayfinder-unlocked-icon");
  const lockedIcon = document.querySelector("#wayfinder-locked-icon");
  const frameStatus = document.querySelector("#wayfinder-frame-status");
  const legDownloads = document.querySelectorAll("#wayfinder-download-master, #wayfinder-download-blank");
  const viewDescription = document.querySelector("#wayfinder-view-description");
  const listHint = document.querySelector("#wayfinder-list-hint");
  const addLeg = document.querySelector("#wayfinder-add-leg");
  const editLeg = document.querySelector("#wayfinder-edit-leg");
  const deleteLeg = document.querySelector("#wayfinder-delete-leg");
  const legDialog = document.querySelector("#wayfinder-leg-dialog");
  const legForm = document.querySelector("#wayfinder-leg-form");
  const legName = document.querySelector("#wayfinder-leg-name");
  const legDescription = document.querySelector("#wayfinder-leg-description");
  const legError = document.querySelector("#wayfinder-leg-error");
  const tools = document.querySelector("#wayfinder-tools");
  const color = document.querySelector("#wayfinder-color");
  const highlightOptions = document.querySelector("#wayfinder-highlight-options");
  const penOptions = document.querySelector("#wayfinder-pen-options");
  const penColor = document.querySelector("#wayfinder-pen-color");
  const penThickness = document.querySelector("#wayfinder-pen-thickness");
  const penStyle = document.querySelector("#wayfinder-pen-style");
  const penHideInput = document.querySelector("#wayfinder-pen-hide");
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
  const labelPositionInput = document.querySelector("#wayfinder-label-position");
  const hideBlankInput = document.querySelector("#wayfinder-hide-blank");
  const highlightHideInput = document.querySelector("#wayfinder-highlight-hide");
  const nameError = document.querySelector("#wayfinder-name-error");
  const container = map.getContainer();
  const layers = L.layerGroup().addTo(map);
  map.createPane("wayfinder");
  map.getPane("wayfinder").style.zIndex = "460";
  const penLayer = L.layerGroup().addTo(map);
  let penPoints = [];
  let penCursor = null;

  let markings = [];
  let legs = [];
  let races = [];
  let selectedRace = null;
  let screen = "home";
  let selectedView = "master";
  let editingLegId = null;
  let editingRace = false;
  let mode = "pan";
  let movingId = null;
  let revision = 0;
  let generation = 0;
  let savedGeneration = 0;
  let savingTask = null;
  let ready = !authEnabled;
  let epoch = 0;
  let timer = null;
  let retryAction = null;
  let pendingName = null;
  let stroke = null;
  let draftLayer = null;
  let consumeClick = false;
  let frameAvailable = false;

  function renderFrameStatus() {
    const leg = legs.find((entry) => entry.id === selectedView);
    frameStatus.textContent = leg?.frame
      ? `Locked: ${leg.frame.paperSize}, ${Math.abs(leg.frame.lat).toFixed(4)}° S, ${leg.frame.lng.toFixed(4)}° E.`
      : frameAvailable
        ? "Unlocked: Position the frame, then lock it before downloading."
        : "Unlocked: Position the map frame before locking.";
  }

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
    viewSelect.disabled = !ready;
    addLeg.disabled = !ready;
    editLeg.disabled = !ready;
    deleteLeg.disabled = !ready;
    document.querySelectorAll("#wayfinder-home button").forEach((button) => { button.disabled = !ready; });
    frameToggle.disabled = !ready;
    legDownloads.forEach((button) => { button.disabled = !ready; });
    tools.querySelectorAll("button").forEach((button) => {
      button.disabled = !ready && button.dataset.wayfinderTool !== "pan";
    });
    list.querySelectorAll("button, select, input").forEach((element) => { element.disabled = !ready; });
  }

  function penWidth(lat, thickness = penThickness.value) {
    return (WAYFINDER_PEN_THICKNESSES_MM[thickness] ?? WAYFINDER_PEN_THICKNESSES_MM.medium) * 50 /
      Math.cos(lat * Math.PI / 180);
  }

  function penLineOptions(marking, opacity = 1) {
    const weight = marking.width * 256 * 2 ** map.getZoom() / mercatorWorldWidth;
    const dash = wayfinderPenDash(marking.style, weight);
    return {
      pane: "wayfinder", color: marking.color, opacity, weight, interactive: false,
      lineCap: marking.style === "dotted" ? "round" : "butt", lineJoin: "round",
      dashArray: dash.length ? dash.join(" ") : null
    };
  }

  function renderPenDraft() {
    penLayer.clearLayers();
    if (!penPoints.length) return;
    const draft = { color: penColor.value, style: penStyle.value, width: penWidth(penPoints[0][0]) };
    const path = penCursor ? [...penPoints, penCursor] : penPoints;
    if (path.length > 1) L.polyline(path, penLineOptions(draft)).addTo(penLayer);
    for (const point of penPoints) {
      L.circleMarker(point, {
        pane: "wayfinder", radius: 3.5, color: "#ffffff", weight: 1.5, fillColor: draft.color,
        fillOpacity: 1, interactive: false
      }).addTo(penLayer);
    }
  }

  function endPen(save = true) {
    const points = penPoints;
    penPoints = [];
    penCursor = null;
    penLayer.clearLayers();
    if (save && points.length >= 2) {
      add({
        id: crypto.randomUUID(), type: "path", color: penColor.value, style: penStyle.value,
        width: penWidth(points[0][0]), points, showOnBlank: !penHideInput.checked
      });
    }
  }

  function setMode(value, id = null) {
    if (mode === "pen" && value !== "pen") {
      endPen();
    }
    mode = value;
    movingId = id;
    tools.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.wayfinderTool === value));
    });
    highlightOptions.hidden = value !== "highlight";
    penOptions.hidden = value !== "pen";
    container.classList.toggle("wayfinder-drawing", value !== "pan");
    const messages = {
      pan: "Choose a tool, then mark the map.",
      cp: "Click the map to add a checkpoint.",
      ta: "Click the map to add a transition area.",
      start: "Click the map to add a start.",
      finish: "Click the map to add a finish.",
      label: "Click the map to add a label.",
      highlight: "Drag over the map to highlight an area. Zoom in for a narrower stroke.",
      pen: "Click to add points. Backspace undoes the last point. Enter or Esc finishes the line.",
      move: "Click the map to move the selected marking."
    };
    hint.textContent = messages[value];
  }

  function draw() {
    layers.clearLayers();
    const activeLeg = legs.find((leg) => leg.id === selectedView && leg.raceId === selectedRace);
    if (!activeLeg || screen !== "editor") return;
    const raceLegs = legs.filter((leg) => leg.raceId === selectedRace);
    for (const leg of raceLegs) {
      const position = leg.frame ?? leg.draft;
      if (leg.id === activeLeg.id || !position) continue;
      const geometry = frameGeometry(position, "A3");
      for (const bounds of [geometry.paper, geometry.map]) {
        L.rectangle([[bounds.south, bounds.west], [bounds.north, bounds.east]], {
          pane: "wayfinder", color: leg.frame ? "#b91c1c" : "#047857",
          opacity: 0.2, weight: 2, fill: false, interactive: false
        }).addTo(layers);
      }
    }
    const legIds = new Set(raceLegs.map((leg) => leg.id));
    const visible = markings.filter((marking) => legIds.has(marking.legId));
    const ordered = [...visible.filter((marking) => marking.type === "highlight"),
      ...visible.filter((marking) => marking.type === "path"),
      ...visible.filter((marking) => marking.type !== "highlight" && marking.type !== "path")]
      .sort((a, b) => Number(a.legId === activeLeg.id) - Number(b.legId === activeLeg.id));
    for (const marking of ordered) {
      const opacity = marking.legId === activeLeg.id ? 1 : 0.2;
      if (marking.type === "path") {
        L.polyline(marking.points, penLineOptions(marking, opacity)).addTo(layers);
        continue;
      }
      if (marking.type === "highlight") {
        L.polyline(marking.points, {
          pane: "wayfinder", color: WAYFINDER_COLORS[marking.color], opacity: 0.45 * opacity,
          weight: marking.width * 256 * 2 ** map.getZoom() / mercatorWorldWidth, interactive: false
        }).addTo(layers);
        continue;
      }
      if (marking.type !== "label") {
        L.circleMarker([marking.lat, marking.lng], {
          pane: "wayfinder", radius: 11, color: wayfinderMarkerColor(marking), weight: 2.5, opacity,
          fill: false, interactive: false
        }).addTo(layers);
      }
      const label = document.createElement("span");
      label.className = "wayfinder-label";
      const isMarker = marking.type === "cp" || marking.type === "ta";
      let iconAnchor = marking.type === "label" ? [0, 8] : [-15, 8];
      if (isMarker) {
        const [dx, dy] = WAYFINDER_LABEL_POSITIONS[marking.labelPosition ?? "bottom"];
        iconAnchor = [-15 * dx, -15 * dy];
        label.classList.add("wayfinder-marker-label");
        label.style.color = wayfinderMarkerColor(marking);
        label.style.setProperty("--wayfinder-label-x", `${(dx - 1) * 50}%`);
        label.style.setProperty("--wayfinder-label-y", `${(dy - 1) * 50}%`);
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
        pane: "wayfinder", interactive: false, keyboard: false, opacity,
        icon: L.divIcon({ className: "", html: label, iconSize: [0, 0],
          iconAnchor })
      }).addTo(layers);
    }
  }

  function renderList() {
    const visible = legWayfinderMarkings({ markings }, selectedView);
    count.textContent = String(visible.length);
    listHint.textContent = "Move, edit, or assign each marking to another leg in this race.";
    list.replaceChildren();
    for (const marking of visible) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = marking.type === "highlight" ? `${marking.color} highlight`
        : marking.type === "path" ? `${marking.style} line` : marking.name;
      item.append(title);
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = marking.showOnBlank !== true;
      checkbox.disabled = !ready;
      checkbox.addEventListener("change", () => {
        marking.showOnBlank = !checkbox.checked;
        changed();
      });
      label.append(checkbox, " Hide on Blank Map");
      item.append(label);
      const assignment = document.createElement("select");
      assignment.className = "field";
      assignment.setAttribute("aria-label", `Leg for ${title.textContent}`);
      for (const leg of legs.filter((entry) => entry.raceId === selectedRace)) {
        assignment.add(new Option(leg.description ? `${leg.name} - ${leg.description}` : leg.name, leg.id));
      }
      assignment.value = marking.legId ?? "";
      assignment.disabled = !ready;
      assignment.addEventListener("change", () => {
        if (assignment.value) {
          marking.legId = assignment.value;
        } else {
          delete marking.legId;
        }
        changed();
      });
      item.append(assignment);
      const button = (label, action) => {
        const element = document.createElement("button");
        element.type = "button";
        element.disabled = !ready;
        element.textContent = label;
        element.setAttribute("aria-label", `${label} ${title.textContent}`);
        element.addEventListener("click", action);
        item.append(element);
      };
      button("Move", () => setMode("move", marking.id));
      if (marking.type !== "highlight" && marking.type !== "path") {
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

  function renderViews() {
    viewSelect.replaceChildren(new Option("Race maps", "master"));
    for (const leg of legs.filter((entry) => entry.raceId === selectedRace)) {
      viewSelect.add(new Option(leg.description ? `${leg.name} - ${leg.description}` : leg.name, leg.id));
    }
    if (selectedView !== "master" && selectedView !== "blank" && !legs.some((leg) => leg.id === selectedView)) {
      selectedView = "master";
    }
    viewSelect.value = selectedView;
    const leg = legs.find((entry) => entry.id === selectedView);
    home.hidden = screen !== "home";
    raceScreen.hidden = screen !== "race";
    mapsScreen.hidden = screen !== "maps";
    editor.hidden = screen !== "editor";
    document.querySelector("#wayfinder-race-library").hidden = !races.length;
    const race = races.find((entry) => entry.id === selectedRace);
    document.querySelector("#wayfinder-race-name").textContent = race?.name ?? "";
    document.querySelector("#wayfinder-race-distance-label").textContent = race?.distanceKm === undefined
      ? "Race distance not set. Add it before downloading a leg."
      : `Race distance: ${race.distanceKm} km`;
    document.querySelector("#wayfinder-master").textContent =
      legs.some((entry) => entry.raceId === selectedRace) ? "View Maps" : "Create Map";
    raceList.replaceChildren();
    for (const race of races) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !ready;
      button.textContent = race.name;
      button.addEventListener("click", () => { selectedRace = race.id; screen = "race"; renderViews(); });
      item.append(button);
      raceList.append(item);
    }
    editorTitle.textContent = leg ? (leg.description ? `${leg.name} - ${leg.description}` : leg.name) : "";
    legMapControls.hidden = !leg;
    frameToggle.dataset.locked = String(Boolean(leg?.frame));
    frameToggle.setAttribute("aria-pressed", String(Boolean(leg?.frame)));
    frameToggleText.textContent = leg?.frame ? "Unlock map selection" : "Lock map selection";
    unlockedIcon.toggleAttribute("hidden", Boolean(leg?.frame));
    lockedIcon.toggleAttribute("hidden", !leg?.frame);
    renderFrameStatus();
    legDownloads.forEach((button) => { button.disabled = !ready || !leg?.frame; });
    legList.replaceChildren();
    for (const entry of legs.filter((item) => item.raceId === selectedRace)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !ready;
      button.textContent = entry.description ? `${entry.name} - ${entry.description}` : entry.name;
      button.addEventListener("click", () => openView(entry.id));
      item.append(button);
      legList.append(item);
    }
    editLeg.hidden = !leg;
    deleteLeg.hidden = !leg;
    viewDescription.textContent = "Other legs are faded while you edit this map.";
  }

  function currentData() {
    return { version: 2, races, legs, markings };
  }

  function notifyView() {
    document.dispatchEvent(new CustomEvent("toposearch:leg-view", {
      detail: { leg: screen === "editor" ? legs.find((entry) => entry.id === selectedView) ?? null : null }
    }));
  }

  function openView(view) {
    selectedView = view;
    screen = "editor";
    setMode("pan");
    renderViews();
    draw();
    renderList();
    notifyView();
  }

  function scheduleSave() {
    if (!authEnabled) {
      setSaveStatus("Local preview only: legs and markings are lost when this page closes or refreshes.");
      return;
    }
    setSaveStatus("Unsaved changes. Saving…");
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  }

  function changed() {
    generation += 1;
    renderViews();
    draw();
    renderList();
    scheduleSave();
  }

  function save() {
    if (savingTask) return savingTask;
    if (generation === savedGeneration || !ready) return Promise.resolve(ready);
    const currentEpoch = epoch;
    const currentGeneration = generation;
    const snapshot = structuredClone(currentData());
    const task = (async () => {
      try {
      const result = await wayfinderRequest("POST", { revision, markings: snapshot });
      if (currentEpoch !== epoch) {
        return false;
      }
      revision = result.revision;
      savedGeneration = currentGeneration;
      if (generation === savedGeneration) {
        setSaveStatus("Saved to your account.");
      } else {
        scheduleSave();
      }
      return true;
      } catch (error) {
      if (currentEpoch === epoch) {
        const message = error.status === 409
          ? "Not saved: changed on another device. Resolve the conflict or reload and discard these changes."
          : `Not saved: ${error.message}`;
        setSaveStatus(message, true, error.status === 409 ? resolveConflict : save);
      }
      return false;
      }
    })();
    savingTask = task;
    task.finally(() => { if (savingTask === task) savingTask = null; });
    return task;
  }

  async function ensureSaved() {
    if (!ready) throw new Error("WayFinder is not ready.");
    if (!authEnabled) return;
    clearTimeout(timer);
    while (generation !== savedGeneration) {
      if (!await save()) throw new Error("Save the leg successfully before downloading.");
    }
  }

  async function resolveConflict() {
    if (!window.confirm("Replace all saved WayFinder legs and markings with this device's version? Changes made on the other device will be lost.")) {
      return;
    }
    const currentEpoch = epoch;
    try {
      const current = await wayfinderRequest();
      if (currentEpoch !== epoch) {
        return;
      }
      if (!Number.isSafeInteger(current.revision) || current.revision < 0 ||
          !validateWayfinderData(current.markings)) {
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
    savingTask = null;
    setReady(false);
    setMode("pan");
    setSaveStatus("Loading saved markings…");
    try {
      const result = await wayfinderRequest();
      if (currentEpoch !== epoch) {
        return;
      }
      if (!Number.isSafeInteger(result.revision) || result.revision < 0 ||
          !validateWayfinderData(result.markings)) {
        throw new Error("The saved markings are invalid.");
      }
      const needsMigration = Array.isArray(result.markings) || result.markings.version !== 2 ||
        result.markings.legs.some((leg) => leg.frame && leg.frame.layoutVersion === undefined);
      const data = migrateWayfinderData(result.markings, () => crypto.randomUUID());
      markings = data.markings;
      legs = data.legs;
      races = data.races;
      selectedRace = null;
      selectedView = "master";
      screen = "home";
      revision = result.revision;
      generation = needsMigration && (legs.length || markings.length) ? 1 : 0;
      savedGeneration = 0;
      setReady(true);
      renderViews();
      draw();
      renderList();
      if (generation) scheduleSave();
      else setSaveStatus("Saved to your account.");
      notifyView();
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
    hideBlankInput.checked = marking.showOnBlank !== true;
    markerColorInput.value = isMarker ? wayfinderMarkerColor(marking) : "#000000";
    labelPositionInput.value = isMarker ? marking.labelPosition ?? "bottom" : "bottom";
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
    const details = { name, showOnBlank: !hideBlankInput.checked };
    if (!markerDetails.hidden) {
      const description = descriptionInput.value.trim();
      if (!validWayfinderDescription(description)) {
        nameError.textContent = "The description must use up to 80 Latin letters, numbers or printable punctuation.";
        nameError.hidden = false;
        return;
      }
      if (!Object.hasOwn(WAYFINDER_LABEL_POSITIONS, labelPositionInput.value)) {
        nameError.textContent = "Choose a valid label position.";
        nameError.hidden = false;
        return;
      }
      details.description = description;
      details.color = markerColorInput.value;
      details.labelPosition = labelPositionInput.value;
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
    const raceLegIds = new Set(legs.filter((leg) => leg.raceId === selectedRace).map((leg) => leg.id));
    const used = markings.filter((marking) => marking.type === type && raceLegIds.has(marking.legId))
      .map((marking) => new RegExp(`^${prefix}(\\d+)$`, "i").exec(marking.name))
      .filter(Boolean).map((match) => Number(match[1]));
    return `${prefix}${Math.max(0, ...used) + 1}`;
  }

  function add(marking) {
    if (selectedView !== "master" && selectedView !== "blank") {
      marking.legId = selectedView;
    }
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
      if (next.type === "highlight" || next.type === "path") {
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
    } else if (mode === "pen") {
      penPoints.push([latlng.lat, latlng.lng]);
      renderPenDraft();
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
        add({ id: crypto.randomUUID(), type: "highlight", color: finished.color, width: finished.width,
          points: finished.points, showOnBlank: !highlightHideInput.checked });
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
  section.addEventListener("toggle", () => {
    if (!section.open) {
      setMode("pan");
    }
  });
  document.querySelector("#wayfinder-add-race").addEventListener("click", () => {
    if (races.length >= WAYFINDER_MAX_RACES) {
      setSaveStatus("Race limit reached.", true);
      return;
    }
    editingRace = false;
    document.querySelector("#wayfinder-race-title").textContent = "Create Race";
    document.querySelector("#wayfinder-race-submit").textContent = "Create Race";
    raceInput.value = "";
    raceDistance.value = "";
    raceError.hidden = true;
    raceDialog.showModal();
    raceInput.focus();
  });
  document.querySelector("#wayfinder-edit-race").addEventListener("click", () => {
    const race = races.find((entry) => entry.id === selectedRace);
    if (!race) return;
    editingRace = true;
    document.querySelector("#wayfinder-race-title").textContent = "Edit race details";
    document.querySelector("#wayfinder-race-submit").textContent = "Save race";
    raceInput.value = race.name;
    raceDistance.value = race.distanceKm ?? "";
    raceError.hidden = true;
    raceDialog.showModal();
    raceInput.focus();
    raceInput.select();
  });
  raceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = raceInput.value.trim();
    if (!validWayfinderName(name)) {
      raceError.textContent = "Use up to 80 printable Latin-1 characters.";
      raceError.hidden = false;
      return;
    }
    const distanceKm = Number(raceDistance.value);
    if (!raceDistance.value || !validRaceDistance(distanceKm)) {
      raceError.textContent = "Enter a race distance greater than zero in kilometres.";
      raceError.hidden = false;
      return;
    }
    if (editingRace) {
      const race = races.find((entry) => entry.id === selectedRace);
      if (!race) return;
      race.name = name;
      race.distanceKm = distanceKm;
    } else {
      const race = { id: crypto.randomUUID(), name, distanceKm };
      races.push(race);
      selectedRace = race.id;
    }
    screen = "race";
    raceDialog.close();
    changed();
  });
  document.querySelector("#wayfinder-race-cancel").addEventListener("click", () => raceDialog.close());
  document.querySelector("#wayfinder-races-back").addEventListener("click", () => {
    screen = "home";
    selectedRace = null;
    renderViews();
  });
  document.querySelector("#wayfinder-master").addEventListener("click", () => {
    screen = "maps";
    renderViews();
  });
  document.querySelector("#wayfinder-race-back").addEventListener("click", () => {
    screen = "race";
    renderViews();
  });
  document.querySelector("#wayfinder-back").addEventListener("click", () => {
    selectedView = "master";
    screen = "maps";
    setMode("pan");
    renderViews();
    draw();
    renderList();
    notifyView();
  });
  addLeg.addEventListener("click", () => {
    if (legs.length >= WAYFINDER_MAX_LEGS) {
      setSaveStatus("WayFinder limit reached. Delete a leg before adding another.", true);
      return;
    }
    editingLegId = null;
    const numbers = legs.filter((leg) => leg.raceId === selectedRace).map((leg) => /^LEG (\d+)$/i.exec(leg.name)).filter(Boolean)
      .map((match) => Number(match[1]));
    legName.value = `LEG ${Math.max(0, ...numbers) + 1}`;
    legDescription.value = "";
    legError.hidden = true;
    legDialog.showModal();
    legDescription.focus();
  });
  editLeg.addEventListener("click", () => {
    const leg = legs.find((entry) => entry.id === selectedView);
    if (!leg) return;
    editingLegId = leg.id;
    legName.value = leg.name;
    legDescription.value = leg.description;
    legError.hidden = true;
    legDialog.showModal();
    legName.focus();
  });
  deleteLeg.addEventListener("click", () => {
    const leg = legs.find((entry) => entry.id === selectedView);
    if (!leg || !window.confirm(`Delete ${leg.name}? Its markings will be kept in a separate Recovered markings map.`)) return;
    const orphaned = markings.filter((marking) => marking.legId === leg.id);
    legs = legs.filter((entry) => entry.id !== leg.id);
    if (orphaned.length) {
      const recovered = { id: crypto.randomUUID(), raceId: leg.raceId, name: "Recovered markings", description: "" };
      legs.push(recovered);
      for (const marking of orphaned) marking.legId = recovered.id;
    }
    selectedView = "master";
    screen = "maps";
    setMode("pan");
    changed();
    notifyView();
  });
  legForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = legName.value.trim();
    const description = legDescription.value.trim();
    if (!validWayfinderName(name) || !validWayfinderDescription(description)) {
      legError.textContent = "Use up to 80 printable Latin-1 characters for the name and description.";
      legError.hidden = false;
      return;
    }
    if (editingLegId) {
      const leg = legs.find((entry) => entry.id === editingLegId);
      if (!leg) return;
      Object.assign(leg, { name, description });
    } else {
      const leg = { id: crypto.randomUUID(), raceId: selectedRace, name, description };
      legs.push(leg);
      selectedView = leg.id;
      screen = "editor";
      setMode("pan");
    }
    legDialog.close();
    changed();
    notifyView();
  });
  document.querySelector("#wayfinder-leg-cancel").addEventListener("click", () => legDialog.close());
  retry.addEventListener("click", () => retryAction?.());
  document.addEventListener("keydown", (event) => {
    if (mode === "pen" && !dialog.open && !legDialog.open && !raceDialog.open) {
      const typing = event.target instanceof Element && event.target.matches("input[type=text], input[type=number], textarea");
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMode("pan");
        return;
      }
      if (event.key === "Backspace" && !typing) {
        event.preventDefault();
        penPoints.pop();
        renderPenDraft();
        return;
      }
    }
    if (event.key === "Escape" && !dialog.open && !legDialog.open && mode !== "pan") {
      setMode("pan");
    }
  }, true);
  container.addEventListener("pointermove", (event) => {
    if (mode === "pen" && penPoints.length) {
      const point = map.mouseEventToLatLng(event);
      penCursor = [point.lat, point.lng];
      renderPenDraft();
    }
  });
  for (const input of [penColor, penThickness, penStyle]) {
    input.addEventListener("input", renderPenDraft);
  }
  document.addEventListener("toposearch:signed-in", load);
  map.on("zoomend", () => {
    draw();
    renderPenDraft();
  });
  document.addEventListener("toposearch:signing-out", (event) => {
    if (generation !== savedGeneration &&
        !window.confirm("WayFinder has unsaved changes. Log out and discard them?")) {
      event.preventDefault();
    }
  });
  document.addEventListener("toposearch:signed-out", () => {
    epoch += 1;
    clearTimeout(timer);
    savingTask = null;
    markings = [];
    legs = [];
    races = [];
    selectedRace = null;
    selectedView = "master";
    screen = "home";
    generation = 0;
    savedGeneration = 0;
    if (raceDialog.open) raceDialog.close();
    if (dialog.open) {
      dialog.close();
    }
    if (legDialog.open) {
      legDialog.close();
    }
    setReady(false);
    setMode("pan");
    draw();
    renderViews();
    renderList();
    notifyView();
  });
  window.addEventListener("beforeunload", (event) => {
    if ((authEnabled && generation !== savedGeneration) || (!authEnabled && (markings.length || legs.length || races.length))) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  setReady(ready);
  renderViews();
  renderList();
  if (!authEnabled) {
    setSaveStatus("Local preview only: legs and markings are lost when this page closes or refreshes.");
  }
  return {
    selectedLeg: () => screen === "editor" ? legs.find((entry) => entry.id === selectedView) ?? null : null,
    raceForLeg: (legId) => {
      const leg = legs.find((entry) => entry.id === legId);
      return races.find((race) => race.id === leg?.raceId) ?? null;
    },
    setDraft: (center) => {
      const leg = screen === "editor" ? legs.find((entry) => entry.id === selectedView) : null;
      if (!leg || leg.frame || (leg.draft?.lat === center.lat && leg.draft?.lng === center.lng)) return;
      leg.draft = { lat: center.lat, lng: center.lng };
      generation += 1;
      draw();
      scheduleSave();
    },
    setMapFrameAvailable: (available) => {
      frameAvailable = available;
      renderFrameStatus();
    },
    setFrame: (frame) => {
      const leg = legs.find((entry) => entry.id === selectedView);
      if (!leg) throw new Error("Select a leg first.");
      const position = frame ?? leg.frame;
      if (position) leg.draft = { lat: position.lat, lng: position.lng };
      if (frame) leg.frame = frame;
      else delete leg.frame;
      changed();
      notifyView();
    },
    ensureSaved,
    legSnapshot: (legId, blank) => structuredClone(legWayfinderMarkings(currentData(), legId, blank)),
    snapshot: () => {
      if (!ready) {
        throw new Error("WayFinder is not ready. Load your saved markings before printing.");
      }
      return structuredClone(visibleWayfinderMarkings(currentData(), selectedView));
    }
  };
}
