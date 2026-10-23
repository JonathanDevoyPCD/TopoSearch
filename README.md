# TopoSearch

A lightweight map viewer focused on topographic sheet **3325CC (Loerie)** and
the surrounding area. Select a sheet boundary to change the selection, then use
**Download print PDF** to make a full-sheet, scale-labeled PDF.

## Run locally

With Node.js installed, run:

```powershell
node .\serve.js
```

Open <http://127.0.0.1:8000>. The local server serves the sheet index, so don't
open `index.html` directly from the filesystem.

## Map coverage and sources

- The online 1:50,000 and 1:250,000 layers are served by the
  [OpenStreetMap htonl NGI tiles viewer](https://htonl.dev.openstreetmap.org/ngi-tiles/).
- The local sheet indexes are regional extracts of the viewer's
  [`sheet50k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet50k.json)
  and [`sheet250k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet250k.json).
  They record map-sheet identifiers, editions, publication years, and bounds.
- The htonl viewer identifies its topographic imagery as **State Copyright**,
  Chief Directorate: National Geo-spatial Information (NGI). Tiles are therefore
  not included in this repository. Confirm NGI's current terms and obtain any
  required permission before downloading, caching, sharing, or using imagery
  for team training.

  The 3325CC sheet index identifies edition 5 (2015), covering 25.0°–25.25° E
  and 33.75°–34.0° S. The overlapping 1:250,000 source sheet is 3324, edition 5
  (2007). Print PDFs are assembled in the browser from the selected
  sheet's tiles at the source's native zoom (15 for 1:50,000; 12 for 1:250,000).
  The 1:50,000 map is laid out on A1 portrait; 1:250,000 uses A0 landscape. The
  printed map area is sized to the selected sheet bounds at the nominal scale,
  with the scale corrected for Web Mercator at the sheet's center latitude.
  Print at 100% / actual size; do not use "fit to page" if the printed scale
  matters. PDFs include the sheet code, edition/year, geographic extent, scale,
  tile-source label, generation time, and NGI attribution.

  Online tile export is relayed through the included local server because the
  tile host does not enable cross-origin canvas export. Only tiles required for
  the user-selected sheet are requested, after the user clicks the print button.
  The server accepts only the fixed NGI tile host, supported layer names, and
  native zoom ranges. Map age, completeness, scale, and fitness for navigation
  must still be checked against official sources before training.

## Offline tiles

The **Local offline tiles** option expects an authorized XYZ/TMS tile pack at
one of these paths:

```text
tiles/
  50k/{z}/{x}/{y}.png
  250k/{z}/{x}/{y}.png
```

The viewer uses TMS row numbering for both layers, matching the online htonl
viewer. No imagery is bundled or downloaded by this project. The local server
must remain running while viewing the tiles. If a tile pack uses a different
format or row scheme, adjust `tileUrl()` and the `tms` setting in `app.js`.
