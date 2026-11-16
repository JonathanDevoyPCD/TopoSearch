export async function decodeTileResponse(response, url, allowNoContent, decodeImage = globalThis.createImageBitmap) {
  if (response.status === 204 && allowNoContent) {
    return null;
  }
  if (!response.ok || response.status === 204) {
    throw new Error(`Tile request failed (${response.status}) for ${url}`);
  }
  try {
    return await decodeImage(await response.blob());
  } catch (error) {
    throw new Error(`Could not decode map tile ${url}: ${error.message}`, { cause: error });
  }
}
