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

## GitHub Pages

The static viewer is hosted from the repository's `main` branch root at
<https://jonathandevoypcd.github.io/TopoSearch/>. Online layers and sheet
selection work there. The hosted PDF download uses the Cloudflare Worker
defined in `worker/index.js`; deploy it once with the steps below.

### Deploy the Cloudflare tile proxy

1. Sign in to Cloudflare and complete Workers onboarding at
   <https://dash.cloudflare.com/?to=/:account/workers-and-pages>. Register the
   free `workers.dev` subdomain when prompted; no custom domain is needed.
2. Install dependencies with `npm install`.
3. Run `npx wrangler login` and authorize Wrangler in the same Cloudflare account.
4. Run `npm run worker:deploy`. Wrangler prints the public `workers.dev` URL.
5. Copy that URL into `PDF_WORKER_BASE_URL` near the top of `app.js`, without a
   trailing slash, then commit and push the change. GitHub Pages will redeploy.
6. Open the Pages site and download a PDF to verify the Worker is connected.

The Worker accepts tile requests only from this GitHub Pages origin, only with a
valid short-lived print token (issued by `POST /pdf/start`, which consumes one
map generation), and only for PNG tiles from the fixed NGI host for the supported
layers and zoom levels within South Africa. It does not accept arbitrary
upstream URLs. Tiles are cached at Cloudflare and in the browser for 30 days,
and each IP is rate limited. Workers Free currently includes 100,000 requests
per day; one full 50k sheet can request several hundred tiles. Monitor usage in
the Cloudflare dashboard, and confirm NGI terms permit this use before sharing PDFs.

Local PDF generation continues to use `node .\serve.js`.

### Accounts, quota and password reset

The site requires sign-in (name, email, password). Accounts live in a Cloudflare D1
database (`worker/schema.sql`); passwords are salted PBKDF2 hashes. Each account gets
`MONTHLY_QUOTA` map generations per calendar month (default 5, set in `wrangler.jsonc`);
quota is enforced by the Worker, not the browser. Race map (TIF) downloads are only
hidden behind the sign-in screen: the GitHub release files themselves are public.

One-time setup:

1. `npx wrangler d1 create toposearch` and put the `database_id` in `wrangler.jsonc`.
2. `npx wrangler d1 execute toposearch --remote --file worker/schema.sql`
3. `npx wrangler secret put SESSION_SECRET` (any long random string).
4. For reset emails: create a [Resend](https://resend.com) API key, run
   `npx wrangler secret put RESEND_API_KEY`, and set `MAIL_FROM` in `wrangler.jsonc`.
   Without a verified sending domain Resend only delivers to your own account email.
5. `npm run worker:deploy`

To run the UI against a local Worker: put `SESSION_SECRET` and
`ALLOWED_ORIGIN=http://127.0.0.1:8000` in `.dev.vars`, apply the schema with
`--local`, run `npx wrangler dev --port 8787`, and open the site with
`?api=http://127.0.0.1:8787`. Without `?api=` the local site skips sign-in.

The interface is styled with Tailwind CSS loaded from its CDN (`index.html`).

## Tools

The tool drawer (top right of the map) has two tools:

- **Select** – click a sheet to select it for download.
- **Free Frame** – click to place a fixed-size, sheet-sized frame (1:50,000: 0.25° × 0.25°; 1:250,000: 2° × 1°),
  then drag it (or its ✥ handle) into position. The PDF covers exactly the frame and lists the source sheets it
  overlaps. On GitHub Pages the frame is limited to the dashed downloadable area.

## Map coverage and sources

- The online 1:50,000 and 1:250,000 layers are served by the
  [OpenStreetMap htonl NGI tiles viewer](https://htonl.dev.openstreetmap.org/ngi-tiles/).
- The sheet indexes in `data/sheets-50k.geojson` and `data/sheets-250k.geojson` are copies of the viewer's national
  [`sheet50k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet50k.json)
  and [`sheet250k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet250k.json).
  They record map-sheet identifiers, editions, publication years, and bounds. Sheets are not drawn as a grid;
  clicking the map selects the sheet under the cursor and outlines only that one. Outside
  South Africa, a 50%-opacity OpenStreetMap base layer is shown under the NGI tiles.
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
  matters. PDF borders include coordinate ticks, a bilingual reference key,
  true/magnetic north references, a scale bar, a neighboring-sheet index, and
  the selected sheet code, edition/year, geographic extent, tile source,
  generation time, and NGI attribution. Magnetic declination is calculated at
  the selected sheet's center for the PDF generation date using the WMM2025
  model; the calculation is local and does not require an API. WMM2025 is valid
  through 2029, so the model must be updated before generating PDFs in 2030.
  The reference key uses generalized symbols based on the supplied example;
  consult the source map for edition-specific symbology.

  The declination calculation uses the [NOAA/NCEI WMM2025
  model](https://www.ncei.noaa.gov/products/world-magnetic-model), implemented
  by `magvar` 2.2.0. Its MIT license is included in `vendor/magvar/LICENSE`.

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
