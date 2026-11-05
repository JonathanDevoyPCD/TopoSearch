const NGI_TILE_ORIGIN = "https://htonl.dev.openstreetmap.org";
import { HttpError, handleAuth, isAuthRoute, requirePrintToken } from "./auth.js";
const TILE_PATH = /^\/(50k|250k)\/(\d+)\/(\d+)\/(\d+)\.png$/;
const MAX_ZOOM = { "50k": 15, "250k": 12 };
const ALLOWED_AREA = {
  west: 16,
  east: 33.5,
  south: -35,
  north: -22
};
const CACHE_SECONDS = 60 * 60 * 24 * 30;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonError(message, status, origin, extra = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function jsonOk(body, origin) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function limited(limiter, request) {
  if (!limiter) {
    return false;
  }
  const client = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await limiter.limit({ key: client });
  return !success;
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
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = String(env.ALLOWED_ORIGIN || "").split(",").map((item) => item.trim());
    if (!origin || !allowedOrigins.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    const url = new URL(request.url);
    if (isAuthRoute(request, url.pathname)) {
      if (await limited(env.AUTH_LIMITER, request)) {
        return jsonError("Too many attempts. Please wait a minute and try again.", 429, origin);
      }
      try {
        return jsonOk(await handleAuth(request, url.pathname, env, ctx), origin);
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonError(error.message, error.status, origin, error.extra);
        }
        console.error("Auth route failed:", error);
        return jsonError("Something went wrong. Please try again.", 500, origin);
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError("Method not allowed", 405, origin);
    }

    const match = url.pathname.match(TILE_PATH);
    if (!match || url.search) {
      return jsonError("Invalid tile path", 400, origin);
    }

    try {
      await requirePrintToken(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.message, error.status, origin);
      }
      throw error;
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
      return jsonError("Tile is outside the supported map area", 404, origin);
    }

    // Per-client limit (Workers Rate Limiting binding, optional). Protects the free quota.
    if (await limited(env.TILE_LIMITER, request)) {
      const tooMany = jsonError("Too many tile requests. Please wait a minute and try again.", 429, origin);
      tooMany.headers.set("Retry-After", "60");
      return tooMany;
    }

    const cache = request.method === "GET" && typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
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
    headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    headers.set("Content-Type", "image/png");
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
    const response = new Response(request.method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers
    });
    if (cache && ctx?.waitUntil) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  }
};
