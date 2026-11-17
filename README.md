# TopoSearch

A lightweight South African topographic map viewer initially centred on
**3325CC (Loerie)**. Place a free frame, choose a paper size, and use
**Download print PDF** to create a map at 1:50,000.

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
`MONTHLY_QUOTA` map generations per calendar month (default 10, set in `wrangler.jsonc`);
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

For an existing deployment, apply the updated schema before deploying the Worker:
`npx wrangler d1 execute toposearch --remote --file worker/schema.sql`, then
`npm run worker:deploy`. The schema uses `CREATE TABLE IF NOT EXISTS` and does
not replace existing account data.

The `leg_generation_pairs` table is required by the updated Worker and must
be created before deployment. Monthly usage includes both `generations` and
`leg_generation_pairs`; an administrative usage reset must account for both.

Deploy the updated Worker before publishing the leg-enabled viewer. Older
Workers reject the new WayFinder format, and older viewers cannot open data
saved in that format; refresh other open tabs after updating.

The interface is styled with Tailwind CSS loaded from its CDN (`index.html`).

## Tools

The sidebar keeps **Map blend** at the top and groups map settings, WayFinder,
and print controls in expandable sections.
Use **Hide tools** to free up space on the map while keeping the blend slider visible.

**WayFinder** is in the sidebar. Add a leg and give it a name and optional
description, then open its screen to add markings. Use **Back to WayFinder**
to choose another leg or the global Master and Blank maps. Each marking can be
assigned to one leg or left unassigned using the markings list. Existing
markings remain unassigned on the Master Map. The Master Map shows all
markings; each leg shows only its own. New markings default to **Hide on Blank
Map**; uncheck it while creating or editing a marking to include it. Highlights
have the same option. The global Blank Map contains included markings from all
legs and unassigned markings.
Deleting a leg leaves its markings unassigned on the Master Map.

In a leg screen, position the frame and choose the paper size, then lock the
selection. A leg remembers its own locked frame across devices. The frame and
paper size cannot be changed until the user confirms unlocking. The leg's
Master PDF contains that leg's markings; its Blank PDF contains only markings
not hidden on the Blank Map. Both are generated with the locked frame.

Choose CP, TA, Start,
Finish or Label, click the map and name the marking. CP and TA names are
suggested in sequence; each can also have an optional description and a
custom marker colour. Choose one of eight label positions around the circle;
names and descriptions match its colour with white outlines on the map and in
PDFs. Existing markers default to a position below the circle and keep their default
pink CP or blue TA colour until changed. Choose Highlighter and drag to draw; yellow, orange,
cyan and green are available. Zoom in before drawing a narrower stroke. Use the
markings list to move, edit or delete items, then choose **Frame / pan** to
adjust the print frame or pan the map. Names and descriptions support up to
80 printable Latin-1 characters.

Signed-in users' markings save to their account and load on other devices.
Saving is not live-synchronized: if another device changes the markings,
WayFinder warns about the conflict rather than silently overwriting them.
Unsaved work can be kept on screen, or explicitly used to replace the saved
version. The local no-sign-in preview keeps markings only until the page closes
or refreshes. The limit is 100 legs, 500 markings and 10,000 highlight points.

Topographic and aerial PDFs use the selected Master, Blank, or leg map. They
include its WayFinder points whose centres are within
the **PRINTED MAP** outline, and clip highlight strokes at that outline.
Markings are not added to original race-map TIF files.

**Map blend** fades between NGI topographic maps and the
[NGI aerial imagery viewer](https://aerial.openstreetmap.org.za/). NGI describes
its newer aerial imagery as 25 cm ground sample distance; coverage, capture
dates and actual detail vary by location. Attribution: State Copyright ©
[Year] Chief Directorate: National Geo-spatial Information. The project owner
has confirmed permission for display and PDF downloads; downloads must be free.
Do not assume that this permission applies to other projects or operators.

The PDF button asks whether to export topographic or aerial imagery; the
on-screen blend does not change the PDF. Aerial exports use zoom 15 or lower,
depending on the selected area, to limit requests and browser memory. These
PDFs have less detail than the highest on-screen zoom or the underlying imagery.
Aerial PDFs carry the imagery attribution
and do not claim that topographic symbols appear on the image. Areas where the
aerial service returns no imagery are shown in grey and identified in the PDF;
an export fails if the entire selected area has no imagery.
The first leg PDF for a locked frame, paper size, map layer, tile source and
imagery type uses one generation even if canceled or failed. Repeated Master
and Blank downloads with those same settings are free while the frame remains
locked, including when the monthly quota is exhausted. Unlocking and locking
again, or choosing a different layer, source or imagery, starts a new paid pair.
Returning to a previously paid combination remains free until the frame is unlocked.
General (non-leg) PDF downloads each use one generation.

**Free Frame** is the map selection tool. Select A0, A1, A2, A3, or A4 portrait
paper, then click or drag the frame to position it. The outer dashed outline
shows the full paper footprint; its shaded border is reserved for page details.
The inner outline marked **PRINTED MAP** shows exactly the imagery included in
the PDF. Changing the paper size changes the area covered, not the print scale.
The frame stays within the dashed downloadable area.

The centre of the printed map identifies the 1:50,000 sheet for original race
map (TIF) and world-file downloads, when available. Those original files are
separate from generated PDFs: paper size and print scale are not controlled by
TopoSearch for TIF files.

## Map coverage and sources

- The online 1:50,000 and 1:250,000 layers are served by the
  [OpenStreetMap htonl NGI tiles viewer](https://htonl.dev.openstreetmap.org/ngi-tiles/).
- The sheet indexes in `data/sheets-50k.geojson` and `data/sheets-250k.geojson` are copies of the viewer's national
  [`sheet50k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet50k.json)
  and [`sheet250k.json`](https://htonl.dev.openstreetmap.org/ngi-tiles/sheet250k.json).
  They record map-sheet identifiers, editions, publication years, and bounds. Sheets are not drawn as a grid;
  optionally outline the 1:50,000 sheet under the frame centre. Outside
  South Africa, a 50%-opacity OpenStreetMap base layer is shown under the NGI tiles.
- The htonl viewer identifies its topographic imagery as **State Copyright**,
  Chief Directorate: National Geo-spatial Information (NGI). Tiles are therefore
  not included in this repository. Confirm NGI's current terms and obtain any
  required permission before downloading, caching, sharing, or using imagery
  for team training.

  The 3325CC sheet index identifies edition 5 (2015), covering 25.0°–25.25° E
  and 33.75°–34.0° S. The overlapping 1:250,000 source sheet is 3324, edition 5
  (2007). PDFs are assembled in the browser from tiles covering the selected
  frame. All generated PDFs use a nominal 1:50,000 scale at the frame centre,
  calculated using WGS84 local east-west and north-south scales. Web Mercator
  scale varies slightly away from the centre, particularly on larger pages.
  Print on the selected paper at 100% / actual size; "fit to page", printer
  scaling, or a smaller paper size changes the scale. Source tiles use zoom 15
  or less for 1:50,000 and zoom 12 or less for 1:250,000; large frames may use a
  lower zoom to keep browser memory bounded. Printing the 1:250,000 layer enlarges
  its source data to 1:50,000 and does not add detail.

  A0 and A1 PDFs include the full generalized bilingual reference key, coordinate
  ticks, north references and sheet index. A2, A3 and A4 use a compact generalized
  legend and scale bar. All show the extent, source, generation time and NGI
  attribution. Magnetic declination is calculated at the frame centre for the PDF generation date using the WMM2025
  model; the calculation is local and does not require an API. WMM2025 is valid
  through 2029, so the model must be updated before generating PDFs in 2030.
  The reference key uses generalized symbols based on the supplied example;
  consult the source map for edition-specific symbology.

  The declination calculation uses the [NOAA/NCEI WMM2025
  model](https://www.ncei.noaa.gov/products/world-magnetic-model), implemented
  by `magvar` 2.2.0. Its MIT license is included in `vendor/magvar/LICENSE`.

  Online tile export is relayed through the included local server because the
  tile host does not enable cross-origin canvas export. Only tiles required for
  the user-selected frame are requested, after the user clicks the print button.
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
