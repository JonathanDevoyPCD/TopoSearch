const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png"
};

async function proxyNgiTile(response, pathname) {
  const match = pathname.match(/^\/ngi-proxy\/(50k|250k)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!match) {
    response.writeHead(400).end("Invalid tile path");
    return;
  }

  const [, layer, zoomText, xText, rowText] = match;
  const zoom = Number(zoomText);
  const x = Number(xText);
  const row = Number(rowText);
  const maximumZoom = layer === "50k" ? 15 : 12;
  if (
    zoom < 4 ||
    zoom > maximumZoom ||
    x >= 2 ** zoom ||
    row >= 2 ** zoom
  ) {
    response.writeHead(400).end("Tile coordinates are outside the supported range");
    return;
  }

  const upstreamUrl =
    `https://htonl.dev.openstreetmap.org/ngi-tiles/tiles/${layer}/${zoom}/${x}/${row}.png`;
  try {
    const upstream = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(20000),
      redirect: "error"
    });
    if (!upstream.ok || !upstream.body) {
      response.writeHead(upstream.status || 502).end("NGI tile request failed");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "image/png"
    });
    const { Readable } = require("node:stream");
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    console.error(`NGI tile proxy failed for ${upstreamUrl}:`, error);
    if (!response.headersSent) {
      response.writeHead(502).end("Could not retrieve the NGI tile");
    } else {
      response.destroy(error);
    }
  }
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Invalid URL");
    return;
  }

  if (pathname.startsWith("/ngi-proxy/")) {
    void proxyNgiTile(response, pathname);
    return;
  }

  const filePath = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const relativePath = path.relative(root, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Length": stats.size,
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end("Could not read file");
    });
    stream.pipe(response);
  });
});

server.listen(8000, "127.0.0.1", () => {
  console.log("TopoSearch is available at http://127.0.0.1:8000");
});
