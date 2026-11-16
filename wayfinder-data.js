export const WAYFINDER_COLORS = {
  yellow: "#facc15",
  orange: "#fb923c",
  cyan: "#22d3ee",
  green: "#4ade80"
};
export const WAYFINDER_POINT_TYPES = ["cp", "ta", "start", "finish", "label"];
export const WAYFINDER_MAX_MARKINGS = 500;
export const WAYFINDER_MAX_POINTS = 10000;

export function validWayfinderName(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 80 && /^[\x20-\x7e\xa0-\xff]+$/.test(value);
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
    }
  }
  return true;
}
