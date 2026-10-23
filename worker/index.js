const NGI_TILE_ORIGIN = "https://htonl.dev.openstreetmap.org";
const TILE_PATH = /^\/(50k|250k)\/(\d+)\/(\d+)\/(\d+)\.png$/;
const MAX_ZOOM = { "50k": 15, "250k": 12 };
const ALLOWED_AREA = {
  west: 23.5,
  east: 26.5,
  south: -34.75,
  north: -32.5
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function tileBounds(zoom, x, tmsRow) {
  const count = 2 ** zoom;
  const y = count - 1 - tmsRow;
  const longitude = (tileX) => (tileX / count) * 360 - 180;
  const latitude = (tileY) => {
    const mercator = Math.PI * (1 - (2 * tileY) / count);
    return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
  };
  return {
    west: longitude(x),
    east: longitude(x + 1),
    north: latitude(y),
    south: latitude(y + 1)
  };
}

function intersectsAllowedArea(bounds) {
  return (
    bounds.east > ALLOWED_AREA.west &&
    bounds.west < ALLOWED_AREA.east &&
    bounds.north > ALLOWED_AREA.south &&
    bounds.south < ALLOWED_AREA.north
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== env.ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError("Method not allowed", 405, origin);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(TILE_PATH);
    if (!match || url.search) {
      return jsonError("Invalid tile path", 400, origin);
    }

    const [, layer, zoomText, xText, rowText] = match;
    const zoom = Number(zoomText);
    const x = Number(xText);
    const tmsRow = Number(rowText);
    const tileCount = 2 ** zoom;
    if (
      !Number.isInteger(zoom) ||
      zoom < 4 ||
      zoom > MAX_ZOOM[layer] ||
      !Number.isInteger(x) ||
      !Number.isInteger(tmsRow) ||
      x < 0 ||
      x >= tileCount ||
      tmsRow < 0 ||
      tmsRow >= tileCount
    ) {
      return jsonError("Tile coordinates outside supported zoom range", 400, origin);
    }
    if (!intersectsAllowedArea(tileBounds(zoom, x, tmsRow))) {
      return jsonError("Tile is outside the Loerie map area", 404, origin);
    }

    const upstreamUrl =
      `${NGI_TILE_ORIGIN}/ngi-tiles/tiles/${layer}/${zoom}/${x}/${tmsRow}.png`;
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        redirect: "manual",
        signal: request.signal
      });
    } catch (error) {
      console.error(`NGI tile request failed for ${upstreamUrl}:`, error);
      return jsonError("NGI tile service is unavailable", 502, origin);
    }

    if (!upstream.ok) {
      return jsonError(`NGI tile request failed (${upstream.status})`, upstream.status, origin);
    }
    if (upstream.headers.get("Content-Type")?.split(";")[0] !== "image/png") {
      return jsonError("NGI returned an unexpected tile format", 502, origin);
    }

    const headers = new Headers(corsHeaders(origin));
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("Content-Type", "image/png");
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers
    });
  }
};
