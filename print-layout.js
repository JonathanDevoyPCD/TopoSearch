export const PRINT_SCALE = 50000;

const PAPER_SIZES = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297]
};
const EARTH_RADIUS = 6378137;
const ECCENTRICITY_SQUARED = 0.0066943799901413165;

export function paperLayout(size) {
  const dimensions = PAPER_SIZES[size];
  if (!dimensions) {
    throw new Error(`Unsupported paper size: ${size}`);
  }
  const [pageWidth, pageHeight] = dimensions;
  const compact = pageWidth < 500;
  const mapX = size === "A3" ? 37.1 * 297 / 1554.8 : compact ? 18 : 110;
  const mapY = size === "A3" ? 36 * 420 / 2199.6 : compact ? 30 : 62;
  const mapWidth = size === "A3" ? 1481.2 * 297 / 1554.8 : pageWidth - 2 * mapX;
  const mapHeight = size === "A3" ? 1914.2 * 420 / 2199.6 : pageHeight - mapY - (compact ? 55 : 190);
  return {
    pageWidth,
    pageHeight,
    mapX,
    mapY,
    mapWidth,
    mapHeight,
    compact
  };
}

export function mercatorY(latitude) {
  return EARTH_RADIUS * Math.asinh(Math.tan(latitude * Math.PI / 180));
}

function latitudeAtMercator(y) {
  return Math.atan(Math.sinh(y / EARTH_RADIUS)) * 180 / Math.PI;
}

export function localScaleFactors(latitude) {
  const radians = latitude * Math.PI / 180;
  const sin = Math.sin(radians);
  const denominator = 1 - ECCENTRICITY_SQUARED * sin * sin;
  return {
    east: Math.cos(radians) / Math.sqrt(denominator),
    north: Math.cos(radians) * (1 - ECCENTRICITY_SQUARED) / denominator ** 1.5
  };
}

export function frameGeometry(center, size) {
  const layout = paperLayout(size);
  const factors = localScaleFactors(center.lat);
  const x = EARTH_RADIUS * center.lng * Math.PI / 180;
  const y = mercatorY(center.lat);
  const projectedX = PRINT_SCALE / 1000 / factors.east;
  const projectedY = PRINT_SCALE / 1000 / factors.north;
  const bounds = (left, top, right, bottom) => ({
    west: (x - left * projectedX) / EARTH_RADIUS * 180 / Math.PI,
    east: (x + right * projectedX) / EARTH_RADIUS * 180 / Math.PI,
    north: latitudeAtMercator(y + top * projectedY),
    south: latitudeAtMercator(y - bottom * projectedY)
  });
  const halfWidth = layout.mapWidth / 2;
  const halfHeight = layout.mapHeight / 2;
  return {
    map: bounds(halfWidth, halfHeight, halfWidth, halfHeight),
    paper: bounds(
      layout.mapX + halfWidth,
      layout.mapY + halfHeight,
      layout.pageWidth - layout.mapX - halfWidth,
      layout.pageHeight - layout.mapY - halfHeight
    )
  };
}

export function clampFrameCenter(center, size, area) {
  let lat = center.lat;
  let lng = center.lng;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { paper } = frameGeometry({ lat, lng }, size);
    const latShift = Math.max(0, area.south - paper.south) - Math.max(0, paper.north - area.north);
    const lngShift = Math.max(0, area.west - paper.west) - Math.max(0, paper.east - area.east);
    lat += latShift;
    lng += lngShift;
    if (Math.abs(latShift) < 1e-10 && Math.abs(lngShift) < 1e-10) {
      return { lat, lng };
    }
  }
  throw new Error("The selected paper does not fit within the downloadable area.");
}

export function rasterZoom(bounds, maximumZoom) {
  const latitudeTile = (latitude, zoom) =>
    (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom;
  for (let zoom = maximumZoom; zoom >= 4; zoom -= 1) {
    const width = (bounds.east - bounds.west) / 360 * 2 ** zoom * 256;
    const height = (latitudeTile(bounds.south, zoom) - latitudeTile(bounds.north, zoom)) * 256;
    if (width <= 8192 && height <= 8192 && width * height <= 50000000) {
      return zoom;
    }
  }
  throw new Error("The selected map area is too large to render.");
}
