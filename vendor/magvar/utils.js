export const deg2rad = (degrees) => degrees * 0.017453292519943295;
export const rad2deg = (radians) => radians * 57.29577951308232;

export const roundToDecimalPlace = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Convert a Gregorian calendar date to Julian Day Number at 00:00 UTC.
 * @param {number} year full year (e.g. 2025)
 * @param {number} month 0-indexed month (0 = January), matching `Date.getUTCMonth()`
 * @param {number} day day of month (1-31)
 * @returns {number} Julian Day Number at 00:00 UTC
 */
export const gregorianToJulian = (year, month, day) =>
  Date.UTC(year, month, day) / 86400000 + 2440587.5;

/**
 * Convert a Date to a decimal year in UTC (e.g. mid-2025 → ~2025.5).
 * @param {Date} [date]
 * @returns {number}
 */
export const dateToDecimalYear = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  const current = Date.UTC(
    year,
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  );
  return year + (current - start) / (next - start);
};

/**
 * Resolve a date input to a WMM decimal year.
 * @param {number|Date} [when] decimal year, Date, or omit for now
 * @returns {number}
 */
export const resolveDecimalYear = (when) => {
  if (when === undefined || when === null) {
    return dateToDecimalYear(new Date());
  }
  if (when instanceof Date) {
    return dateToDecimalYear(when);
  }
  if (typeof when === 'number' && Number.isFinite(when)) {
    return when;
  }
  throw new TypeError('when must be a decimal year number or Date');
};

export const zeroArray2D = (rows, columns) =>
  Array.from({ length: rows }, () => Array(columns).fill(0));
