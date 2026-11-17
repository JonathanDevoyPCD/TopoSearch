export const WAYFINDER_COLORS = {
  yellow: "#facc15",
  orange: "#fb923c",
  cyan: "#22d3ee",
  green: "#4ade80"
};
export const WAYFINDER_MARKER_COLORS = {
  cp: "#e5007d",
  ta: "#006de5",
  start: "#000000",
  finish: "#000000"
};
export const WAYFINDER_LABEL_POSITIONS = {
  top: [0, -1],
  "top-right": [1, -1],
  right: [1, 0],
  "bottom-right": [1, 1],
  bottom: [0, 1],
  "bottom-left": [-1, 1],
  left: [-1, 0],
  "top-left": [-1, -1]
};
export const WAYFINDER_POINT_TYPES = ["cp", "ta", "start", "finish", "label"];
export const WAYFINDER_MAX_MARKINGS = 500;
export const WAYFINDER_MAX_POINTS = 10000;
export const WAYFINDER_MAX_LEGS = 100;
export const WAYFINDER_MAX_RACES = 100;

export function validWayfinderName(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 80 && /^[\x20-\x7e\xa0-\xff]+$/.test(value);
}

export function validWayfinderDescription(value) {
  return value === "" || validWayfinderName(value);
}

export function wayfinderMarkerColor(marking) {
  return marking.color ?? WAYFINDER_MARKER_COLORS[marking.type];
}

function validPosition(lat, lng) {
  return Number.isFinite(lat) && lat >= -85 && lat <= 85 &&
    Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function validateWayfinderMarkings(markings) {
  if (!Array.isArray(markings) || markings.length > WAYFINDER_MAX_MARKINGS) {
    return false;
  }
  const ids = new Set();
  let pointCount = 0;
  for (const marking of markings) {
    if (!marking || typeof marking !== "object" || typeof marking.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(marking.id) || ids.has(marking.id)) {
      return false;
    }
    ids.add(marking.id);
    if (marking.type === "highlight") {
      if (!Object.hasOwn(WAYFINDER_COLORS, marking.color) || !Array.isArray(marking.points) ||
          marking.points.length < 2 || !Number.isFinite(marking.width) ||
          marking.width <= 0 || marking.width > 1000000) {
        return false;
      }
      pointCount += marking.points.length;
      if (pointCount > WAYFINDER_MAX_POINTS ||
          !marking.points.every((point) => Array.isArray(point) && point.length === 2 &&
            validPosition(point[0], point[1]))) {
        return false;
      }
    } else if (!WAYFINDER_POINT_TYPES.includes(marking.type) ||
        !validPosition(marking.lat, marking.lng) || !validWayfinderName(marking.name)) {
      return false;
    } else if ((marking.type === "cp" || marking.type === "ta") &&
        ((marking.description !== undefined && !validWayfinderDescription(marking.description)) ||
         (marking.color !== undefined && (typeof marking.color !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(marking.color))) ||
         (marking.labelPosition !== undefined && (typeof marking.labelPosition !== "string" ||
          !Object.hasOwn(WAYFINDER_LABEL_POSITIONS, marking.labelPosition))))) {
      return false;
    }
  }
  return true;
}

export function validateWayfinderData(data) {
  if (Array.isArray(data)) {
    return validateWayfinderMarkings(data);
  }
  if (!data || typeof data !== "object" || ![1, 2].includes(data.version) ||
      !Array.isArray(data.legs) || data.legs.length > WAYFINDER_MAX_LEGS + (data.version === 2 ? 1 : 0) ||
      !validateWayfinderMarkings(data.markings)) {
    return false;
  }
  const raceIds = new Set();
  if (data.version === 2) {
    if (!Array.isArray(data.races) || data.races.length > WAYFINDER_MAX_RACES) return false;
    for (const race of data.races) {
      if (!race || typeof race.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(race.id) ||
          raceIds.has(race.id) || !validWayfinderName(race.name)) return false;
      raceIds.add(race.id);
    }
  }
  const legIds = new Set();
  for (const leg of data.legs) {
    if (!leg || typeof leg.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(leg.id) ||
        leg.id === "master" || leg.id === "blank" ||
        legIds.has(leg.id) || !validWayfinderName(leg.name) ||
        !validWayfinderDescription(leg.description) ||
        (data.version === 2 && !raceIds.has(leg.raceId)) ||
        (leg.draft !== undefined && (!leg.draft || !validPosition(leg.draft.lat, leg.draft.lng))) ||
        (leg.frame !== undefined && (!validWayfinderFrame(leg.frame) ||
          (data.version === 2 && leg.frame.paperSize !== "A3")))) {
      return false;
    }
    legIds.add(leg.id);
  }
  return data.markings.every((marking) =>
    ((data.version === 1 && marking.legId === undefined) || legIds.has(marking.legId)) &&
    (marking.showOnBlank === undefined || typeof marking.showOnBlank === "boolean"));
}

export function migrateWayfinderData(data, newId) {
  if (!validateWayfinderData(data)) throw new Error("The saved markings are invalid.");
  if (!Array.isArray(data) && data.version === 2) return structuredClone(data);
  const markings = structuredClone(Array.isArray(data) ? data : data.markings);
  const legs = structuredClone(Array.isArray(data) ? [] : data.legs);
  if (!markings.length && !legs.length) return { version: 2, races: [], legs: [], markings: [] };
  const race = { id: newId(), name: "Imported race" };
  for (const leg of legs) {
    leg.raceId = race.id;
    if (leg.frame && leg.frame.paperSize !== "A3") {
      leg.frame = { ...leg.frame, id: newId(), paperSize: "A3" };
    }
  }
  const legIds = new Set(legs.map((leg) => leg.id));
  const unassigned = markings.filter((marking) => !legIds.has(marking.legId));
  if (unassigned.length) {
    const leg = { id: newId(), raceId: race.id, name: "Imported markings", description: "" };
    legs.push(leg);
    for (const marking of unassigned) marking.legId = leg.id;
  }
  const migrated = { version: 2, races: [race], legs, markings };
  if (!validateWayfinderData(migrated)) {
    throw new Error("The existing markings could not be imported safely.");
  }
  return migrated;
}

export function validWayfinderFrame(frame) {
  return Boolean(frame && typeof frame === "object" &&
    typeof frame.id === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(frame.id) &&
    validPosition(frame.lat, frame.lng) &&
    ["A0", "A1", "A2", "A3", "A4"].includes(frame.paperSize));
}

export function visibleWayfinderMarkings(data, view) {
  if (view === "master") {
    return data.markings;
  }

  if (view === "blank") {
    return data.markings.filter((marking) => marking.showOnBlank === true);
  }
  return data.markings.filter((marking) => marking.legId === view);
}

export function legWayfinderMarkings(data, legId, blank = false) {
  return data.markings.filter((marking) =>
    marking.legId === legId && (!blank || marking.showOnBlank === true));
}
