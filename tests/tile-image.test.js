import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTileResponse } from "../tile-image.js";

test("aerial no-content tiles are marked as missing without decoding", async () => {
  const response = new Response(null, { status: 204 });
  const bitmap = await decodeTileResponse(response, "aerial-tile", true, () => {
    throw new Error("A missing tile must not be decoded");
  });
  assert.equal(bitmap, null);
});

test("no-content tiles are not accepted for topographic imagery", async () => {
  const response = new Response(null, { status: 204 });
  await assert.rejects(decodeTileResponse(response, "topo-tile", false), /204.*topo-tile/);
});

test("valid tiles decode, while server and decode errors remain explicit", async () => {
  const expected = { width: 256 };
  const response = new Response(new Blob(["image"]), { status: 200 });
  assert.equal(await decodeTileResponse(response, "valid-tile", true, () => expected), expected);
  await assert.rejects(
    decodeTileResponse(new Response(null, { status: 503 }), "failed-tile", true),
    /503.*failed-tile/
  );
  await assert.rejects(
    decodeTileResponse(new Response("bad image"), "corrupt-tile", true, () => {
      throw new Error("invalid image");
    }),
    /corrupt-tile: invalid image/
  );
});
