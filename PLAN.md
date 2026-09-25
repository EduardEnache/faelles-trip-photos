# fælles. — implementation plan

Read `BRIEF.md` first. This plan turns the prototype (`design/Trip App.dc.html`) into a real,
deployable app. It is decisive on purpose. The scaffold described in §11 already exists and compiles.

**Design read:** a private, content-first photo app for four friends on phones on patchy data, in a
quiet Nordic language the designer already defined (Kalk/Papir/Blæk neutrals, one Fjord action
colour, Instrument Sans + Geist Mono, Phosphor Light). Dials: variance 3, motion 4, density 5. We do
not restyle; we make it real, honest and robust. Light library, dark viewer/player (designer's
call, so no auto dark mode for the library).

---

## 1. Architecture

```
 phone ──https──> Tailscale Funnel :10000  --set-path=/photos (strips prefix)
                              │
                              ▼
            127.0.0.1:8497  ┌──────────────────────────────────────────────┐
                            │ container faelles-trip-photos                 │
                            │ node:22-alpine3.20 + vips-tools vips-heif     │
                            │   ffmpeg exiftool tini                         │
                            │                                                │
                            │ Fastify 5 (one process)                        │
                            │  ├ rewriteUrl: '/photos/x' → '/x'              │
                            │  ├ /api/*  JSON + SSE + media + zip            │
                            │  ├ /api/uploads/*  tus 1.0 (@tus/server 2)     │
                            │  ├ static SPA (web/dist) + index.html fallback │
                            │  └ in-process job queue (photo lane, video)    │
                            │ better-sqlite3 (WAL)                           │
                            └───────────────┬────────────────────────────────┘
                                            │ bind mount ./storage → /data
```

- **One container, one Node process.** `node:22-alpine3.20` (Node 20 is EOL since April 2026;
  Node 22 LTS on the same Alpine 3.20 whose `vips-tools vips-heif ffmpeg exiftool` set is verified
  in BRIEF.md). `tini` as PID 1. Runs as `1000:1000` so files in `./storage` belong to the user.
- **Port:** container listens on 8497; compose publishes `127.0.0.1:8497:8497`.
- **Build:** multi-stage Dockerfile. `build` stage (with `python3 make g++` as better-sqlite3
  fallback) builds `web/` (Vite) and `server/` (esbuild bundle, `--packages=external`, which also
  inlines `shared/`), then `npm ci --omit=dev` for the server. `test` stage = build stage + media
  tools, runs `npm test` (the only place the tool-dependent tests run). `runtime` stage copies
  `server/dist`, prod `node_modules`, `web/dist → /app/public`.
- **Config (env):** `PORT=8497`, `STORAGE_DIR=/data`, `FAELLES_PIN=1234`, `ALBUM_TITLE="Denmark 2026"`,
  `PHOTO_CONCURRENCY=4`, `VIDEO_CONCURRENCY=2`, `LOG_LEVEL=info`, `BUILD_VERSION` (git sha build arg).
  Session secret: `STORAGE_DIR/secret.key` (32 random bytes, created on first boot, mode 600).

### 1.1 Storage layout (`./storage`, mounted at `/data`)

```
storage/
  originals/<person>/<ULID>-<safe original name>   byte-identical, never rewritten
  derived/<ULID>/thumb.webp display.webp [poster.jpg preview.mp4]
  incoming/                                         @tus/file-store (partial uploads + .json)
  trash/<ULID>/...                                  deleted items (original + derived), 30 days
  db/faelles.sqlite (+ -wal, -shm)
  secret.key
```

`safe original name` = basename, NFC, `[^\p{L}\p{N}._ -]` → `_`, max 120 chars. The DB keeps the
exact original name for downloads. Originals are human-browsable for backups.

### 1.2 `/photos` prefix strategy (must work stripped or present)

- Web: Vite `base: '/photos/'`; every request uses `import.meta.env.BASE_URL + 'api/...'`
  (`web/src/lib/api.ts`). No absolute `/api` anywhere.
- Server: Fastify `rewriteUrl` strips a leading `/photos` (see `stripBase` in the stub). Routes are
  registered once, without prefix. **Never redirect `/` → `/photos/`** (with Funnel stripping, that
  loops). `/` and `/photos/` both serve `index.html`; assets resolve under `/photos/assets/...`,
  which works in both modes.
- tus: `Location` is **relative** (just the upload id, via `generateUrl`). tus-js-client resolves it
  against the endpoint `https://host/photos/api/uploads/` → keeps the prefix. `getFileIdFromRequest`
  takes the last path segment, so it works whatever `req.raw.url` contains. the backend verifies both
  modes with `scripts/strip-proxy.mjs` (a 20-line Node proxy that strips `/photos`, dev-only).
- Cookie `Path=/` (works in both modes).

### 1.3 Auth

- `POST api/session {pin}` compares with `FAELLES_PIN` using `crypto.timingSafeEqual` on the
  padded strings. On success: signed cookie `faelles_session` (`@fastify/cookie` signing with
  `secret.key`), payload `{v:1, iat, pv, person}` where `pv` = first 8 hex of
  `sha256(PIN + secret)`. Changing the PIN env invalidates every session (cheap "PIN rotation").
- httpOnly, `SameSite=Lax`, `Path=/`, `Max-Age = 90 days`. `Secure` when the request came through
  the proxy (`X-Forwarded-Proto: https` or `X-Forwarded-For` present); plain on local http.
- "Who's this" lives in the cookie (`PUT api/session/person`), so uploads/hearts are attributed
  server-side without trusting request bodies. Per device, changeable.
- **Throttling (public URL):** client IP = **rightmost** `X-Forwarded-For` entry (the one the
  local proxy appended; the port is bound to 127.0.0.1 so only the proxy can reach us), else the
  socket address. Per IP: 5 failures / 15 min → lockout 60 s, doubling per repeat lockout, cap 1 h.
  **Global backoff:** 20 failures across all IPs within 60 min → PIN entry locked for everyone for
  15 min (existing sessions unaffected). Every failure also waits 400 ms before answering. State in
  memory (a restart resetting it is acceptable). All numbers in `LIMITS`.
  Worst case for a distributed attacker: ~480 guesses/day of 10 000, longer than the trip.
- Every `/api/*` except `health` and `GET/POST session` requires the cookie (401 otherwise),
  including media, zip and SSE. The SPA shell and hashed assets are public (they contain no data).
- Headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `X-Frame-Options: DENY`, `X-Robots-Tag: noindex`, and a CSP:
  `default-src 'self'; img-src 'self' blob: data: https://tiles.openfreemap.org; media-src 'self' blob:;
  connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; style-src 'self' 'unsafe-inline';
  font-src 'self'; frame-ancestors 'none'`.

### 1.4 Uploads: tus

**Decision: tus** (`@tus/server` 2 + `@tus/file-store` 2 on the server, `tus-js-client` 4 in the
browser) over a custom chunk protocol. Resume-by-offset (HEAD), retry with backoff, fingerprint
resume after a reload (re-pick the same file → continues where it stopped), chunking, termination
and size limits are all standard and tested; a custom protocol would re-implement each of them,
exactly where flaky train Wi-Fi will find the bugs. Cost is two small deps.

Flow:
1. `POST api/uploads/` with metadata `filename`, `filetype`, `lastModified`. `onIncomingRequest`
   checks the session (401) and person (409). `onUploadCreate` validates type
   (`isAcceptedFile`, 415), size ≤ 10 GiB (413), disk guard (507, §1.9), and stamps
   `metadata.person` server-side.
2. Client PATCHes 8 MiB chunks (`LIMITS.uploadChunkBytes`); dropped connections lose ≤ 8 MiB.
3. `onUploadFinish` = **finalize** (awaited, a few hundred ms): rename into
   `originals/<person>/…` (same filesystem), stream sha256, **dedupe** (same hash among
   non-deleted items → delete new bytes, return existing item, `Faelles-Duplicate: 1`), run
   exiftool (§1.5), insert item (`status 'processing'`), record `uploads(upload_id → item_id)`,
   enqueue derivatives, broadcast `item.added`, return headers `Faelles-Item-Id`, `Faelles-Duplicate`.
4. Fallback for clients that missed the headers: `GET api/upload-results/:uploadId`.
5. Hourly: purge `incoming/` uploads older than 72 h.

### 1.5 Metadata (exiftool)

`exiftool -json -n -G1 -a -api largefilesupport=1 <file>` via `execFile` (one call per file, a
semaphore of 4). A pure, unit-tested `resolveCapture(tags, {lastModified, receivedAt})` in
`server/src/media/capture.ts` returns `{takenAt, dateSource}`:

| Kind | Priority | dateSource |
|---|---|---|
| photo | `ExifIFD:DateTimeOriginal` + `ExifIFD:OffsetTimeOriginal` (or `OffsetTime`) | `exif` |
| photo | `XMP-exif:DateTimeOriginal` / `XMP-photoshop:DateCreated` with a zone | `exif` |
| photo | `DateTimeOriginal` / `CreateDate` / `PNG:CreationTime` without zone → **Europe/Copenhagen wall time** (`zonedWallTimeToUtc`) | `exif-local` |
| video | `Keys:CreationDate` (Apple, carries `+02:00`) / `ItemList:CreationDate` / `QuickTime:CreationDate` with zone | `exif` |
| video | `QuickTime:CreateDate` / `MediaCreateDate` (UTC per spec; Android + most cameras) unless `0000:00:00` | `video-utc` |
| any | tus `lastModified` | `file` |
| any | server receive time | `upload` |

Dates before 2000 or more than 2 days in the future are ignored (next rule). Phones switch to
Danish time automatically, so "wall time = Copenhagen" is right for zone-less EXIF.
GPS: `Composite:GPSLatitude/GPSLongitude` (signed with `-n`, covers photos and QuickTime
`GPSCoordinates`); drop `0,0`. Camera: `Make`/`Model` with the Make prefix de-duplicated
("Apple iPhone 16 Pro" → "iPhone 16 Pro"); videos use `Keys:Model`. Lens =
`FocalLengthIn35mmFormat` (fallback `FocalLength`) as `24mm`; `FNumber`; `ExposureTime` → `1/250`
or `2s`; `ISO`. Dimensions: photo `ImageWidth/Height` swapped for Orientation 5–8; video from
ffprobe incl. rotation side data. Duration from ffprobe.

### 1.6 Derived media (vips, ffmpeg) + queue

Photos (HEIC/HEIF/JPEG/PNG/WebP/TIFF/DNG/RAW):
- `vips thumbnail <in> thumb.webp[Q=76,strip] 640 --size down --export-profile srgb` and
  `display.webp[Q=82,strip] 2048 …`. `thumbnail` auto-rotates by EXIF.
- **WebP only, no AVIF.** WebP is universal on target browsers and fast to encode; AVIF encoding
  through Alpine's libheif is slow and its encoder availability is not verified. Not worth the risk
  today.
- DNG/RAW: try vips; on failure extract the embedded preview (`exiftool -b -JpgFromRaw`, then
  `-PreviewImage`) to a temp JPEG and thumbnail that. If nothing works → `failed` with
  "No preview for this RAW file. The original is safe."
- `tone`: `vips thumbnail thumb.webp tone.v 1 --height 1 --size force` → `vips getpoint` → `#rrggbb`.

Videos (MOV/MP4/…):
- `ffprobe -show_streams -show_format -of json` → duration, size, rotation, `color_transfer`.
- Poster: frame at `min(1s, duration/2)` → `poster.jpg` → same vips thumb/display webp.
  Broadcast `item.updated` as soon as the poster exists (tile appears quickly).
- **Preview** (iPhone HEVC/HDR won't play outside Safari): `libx264 -preset veryfast -crf 23
  -profile:v high -pix_fmt yuv420p`, long edge ≤ 1280, `-fpsmax 30`, `aac 128k` stereo,
  `-movflags +faststart`, `-threads 4`, written to `preview.tmp.mp4` then renamed. HDR
  (`arib-std-b67` / `smpte2084`): tonemap via `zscale…tonemap=hable…` if `zscale` exists (checked at
  boot), else a plain `format=yuv420p` conversion (a little flat, still plays). Always serve the
  preview in the viewer (lighter on mobile data); the original is only for downloads.
- **Queue:** in-process, two lanes: photo (concurrency `PHOTO_CONCURRENCY`=4) and video
  (`VIDEO_CONCURRENCY`=2, ffmpeg `-threads 4`). Durable through the DB: on boot every item with
  `status='processing'` is re-enqueued. One retry, then `status='failed'` with a short `error`.
  Timeouts: photo 120 s, video 30 min. `rev` increments when derivatives change.
- Tool detection at boot (`vips --version`, `vips -l | grep heif`, `ffmpeg -version`,
  `exiftool -ver`) → `HealthDTO.tools`; missing tools make items `failed`, never crash the server.

### 1.7 Live updates (SSE)

`GET api/events`: `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, a
`hello` first, `: ping` every 25 s. Events are the `ServerEvent` union in `shared/api.ts`. The web
store (`web/src/state/library.ts`, done) reloads `api/library` on every reopen, then applies events,
so a missed event can never leave a client stale for longer than a reconnect.

### 1.8 Getting originals out

- **Single original:** `GET api/media/:id/original?download=1` → exact bytes, `Content-Disposition:
  attachment; filename="IMG_5120.HEIC"; filename*=UTF-8''…`, Range support.
- **ZIP (desktop, and mobile for big sets):** `POST api/zip` → ticket (30 min) → browser navigates to
  `GET api/zip/:token`. `yazl` with `compress:false` (STORE), zip64 automatic; since every entry size
  is known, `end({}, finalSize)` gives the **exact Content-Length**, so the browser shows real
  progress and ETA. Entries `Day 2 - Sat 26 Sept/IMG_5120.HEIC` (`zipFolderName`), duplicates get
  ` (2)`, entry mtime = takenAt. Names `denmark-2026-all.zip`, `denmark-2026-selection-12.zip`.
  The toast is honest: "Download started · 12 originals · 1.4 GB" (no fake percentage; the browser
  owns the progress of a navigated download).
- **Mobile "Save to Photos":** Web Share API with files, two steps because iOS requires a fresh user
  gesture for `navigator.share` after a long fetch: (1) tap Save → originals are fetched with **real**
  byte progress in the toast; (2) toast turns into "5 originals ready" with a **Save** action → the OS
  share sheet, where the user picks "Save Image / Save Video". Copy never names an album
  ("A web app can't create an album in Photos" is simply never promised). Limits: ≤ 30 files and
  ≤ 400 MB per share (memory safety on iOS Safari), else we offer the ZIP. No `canShare({files})` →
  single original download / ZIP.

### 1.9 Other server features

- **Hearts** (personal, `PUT/DELETE api/items/:id/heart`), **highlight** (shared star,
  `PUT/DELETE …/highlight`), both idempotent, broadcast `item.updated`.
- **Remove my upload:** `DELETE api/items/:id` (own only, 403 otherwise) moves original + derived to
  `trash/`, sets `deleted_at`; **Undo** via `POST …/restore` (toast action, 8 s). Trash purged after
  30 days.
- **Day captions:** `PUT api/days/:day/caption {text}` (≤ 140 chars, single line, empty deletes).
- **Disk guard:** `fs.statfs(STORAGE_DIR)` every 60 s and at upload creation. Refuse when
  `free < 10 GiB + upload length` (507). `lowSpace` under 40 GiB → quiet note in the upload sheet.
  Broadcast `disk` when either flag flips.

### 1.10 Database (better-sqlite3, WAL, `PRAGMA foreign_keys=ON`)

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
  uploader TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  file_name TEXT NOT NULL, stored_path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  taken_at TEXT NOT NULL, date_source TEXT NOT NULL,
  width INTEGER, height INTEGER, duration_ms INTEGER, lat REAL, lon REAL,
  camera TEXT, lens TEXT, f_number REAL, exposure TEXT, iso INTEGER, tone TEXT,
  has_thumb INTEGER NOT NULL DEFAULT 0, has_display INTEGER NOT NULL DEFAULT 0,
  has_preview INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0,
  highlighted_by TEXT, deleted_at TEXT
);
CREATE INDEX items_taken ON items(taken_at, id) WHERE deleted_at IS NULL;
CREATE INDEX items_sha ON items(sha256) WHERE deleted_at IS NULL;
CREATE TABLE hearts (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (item_id, person));
CREATE TABLE captions (day TEXT PRIMARY KEY, text TEXT NOT NULL, person TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE uploads (upload_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, duplicate INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version
```

`day` in `ItemDTO` is computed at read time with `dayOf(taken_at)` (never stored), so a rule change
needs no migration.

---

## 2. Day and place logic (`shared/trip.ts`, done + tested)

- **Days** are Copenhagen-local dates with a **04:00 boundary** (a 01:30 photo from a night out
  belongs to the evening it started). The viewer still shows the true date and time.
- **Outside 25–28 Sept → explicit "Before the trip" / "After the trip" sections** (top / bottom),
  never clamped into day 1 or 4. Clamping would silently mis-sort airport and home photos.
- `nearestPoi` uses real distance (haversine, 1.2 km) over the prototype's 8 POIs plus the group's
  real itinerary (from `~/copenhagen-pass-maximizer`). `cityOf` falls back to towns with radii
  (incl. Helsingborg and Malmö for a ferry or bridge trip).
- `deriveDay` = prototype rule: the busiest POI names the day's city; the first two POIs in time
  order form the subtitle; `gpsPoints` feeds the "GPS · 14 PTS" tag. No GPS → the header shows only
  the date and "No location data" (never the planned city; that would be fake data).
- Files without EXIF: the dateSource shows in the viewer ("date from file" / "date unknown").

---

## 3. Memories (package C)

All derived client-side from the library store (`features/memories/pickMemories.ts`, pure,
unit-tested). Only `status==='ready'` items. A memory needs **at least** the listed items, else it
does not exist (no placeholder cards).

| id | Exists when | Title / sub | Slides | Mood |
|---|---|---|---|---|
| `trip` | ≥ 8 items across ≥ 2 trip days | "Four days in Denmark" when all 4 days have items, else "Denmark so far"; sub "The whole trip" / "Days 1–2 so far" | ≤ 18: per-day quota ∝ day size (min 2 per day); within a day highest score first (score = 3·highlight + hearts), rest evenly spaced in time; then chronological | Kystlys |
| `loved` | ≥ 5 items with a heart or highlight | "The four of us" / "Most-loved moments" | top 12 by score, then chronological | Lys |
| `city-<slug>` | a derived city spanning ≥ 2 days with ≥ 10 items | "København" / "Days 1–2" | ≤ 14, same sampling as trip | by city |
| `day-<n>` | ≥ 6 items that day | "Saturday in København" (city from `deriveDay`, else "Day 2") / "Day 2 · Tivoli · Superkilen" | ≤ 12 | by city |

Order in the tab: trip, loved, cities, days (newest first). **Featured card** in the library = `trip`
if it exists, else the newest day memory; the label says "NEW MEMORY" only if its slide set changed
since this device last opened it (signature in localStorage), otherwise "MEMORY". No memory → no
card. Videos: at most one in four slides, play the muted preview from 0 for min(duration, 6 s).
Photo slides 4.2 s. Length label = real sum (`0:48`).

Empty state (tab): "Memories make themselves once there are at least 8 photos from two days.
Right now: 3 photos from 1 day." (numbers real).

### 3.1 Player

- Full-bleed Nat, `display.webp` with slow Ken Burns (`kb0`/`kb1`, duration = slide length),
  story segments on top (2 px), tap left/right thirds to skip, title card on slide 1, ended screen.
- **One clock:** a rAF loop advances `t` (ms) while playing; slide index comes from cumulative slide
  durations. Segment bars and Ken Burns progress are driven through refs/CSS vars (no React render
  per frame). Pause stops the clock and `animation-play-state`, and fades audio. Tab hidden
  (`visibilitychange`) → pause. Preload the next two images; a slide waits (clock holds) until its
  image decoded, so slow networks stall rather than show a blank.
- Keys: Space play/pause, ←/→ skip, M mute, Esc close. Reduced motion → no zoom, 300 ms crossfades.
- **Ended:** "Tak for turen." (trip, city, loved) or "Tak for i dag." (day). Buttons: Replay
  (outlined) and **"Save these 12"** (calls `saveItems(slides)` from `lib/save.ts`).
- **"Save video" is cut.** A faithful server render would need to re-implement the browser's
  generated audio offline plus an ffmpeg zoompan pipeline over 4K stills (minutes of CPU per memory,
  new failure modes) while the trip is happening; client-side MediaRecorder capture is real-time and
  browser-specific. Saving the memory's originals is what people actually want from it, and it is
  honest.

### 3.2 Generative ambient audio (Web Audio)

`features/memories/audio/engine.ts` owned by C. One mood per memory, "Change" cycles through all
five for this session, **mute** toggle persisted per device (localStorage), default on.

- Graph: voices → `lowpass` → `master` gain → `DynamicsCompressor` → destination, with a send to a
  `ConvolverNode` using a generated IR (2.8 s exponentially decaying stereo noise).
- Voices: **pad** (3 detuned oscillators, attack 2 s, release 3 s, slow filter LFO), **bells**
  (sine + inharmonic partial ×2.76, short decay, sparse random notes from the scale), optional
  **sea/wind bed** (looped noise buffer → bandpass with slow amplitude LFO).
- Moods (name / scale / character): **Kystlys** D major pentatonic, warm pad + sea;
  **Havnen** A dorian, soft keys, low bed; **Glas** F lydian, glassy bells, little pad;
  **Sund** E aeolian, low fifths drone + wind; **Lys** G major, bright pad, more bells.
  City → mood: København Havnen, Humlebæk Glas, Helsingør Sund, others Kystlys.
- Scheduling: lookahead scheduler (25 ms tick, 1 s horizon on `ctx.currentTime`), seeded PRNG
  (mulberry32 of memory id + mood) so a memory sounds the same each time. Chord changes are
  aligned to slide boundaries (`engine.onSlide(i)`), which is the only coupling to the visual clock.
- Lifecycle: create/resume the `AudioContext` inside the tap that opened the player (autoplay
  policy); pause = 300 ms ramp then `suspend()`; close = 600 ms fade then `close()`.
- Label everywhere: MusicIcon + "Kystlys · generated ambient" (replaces "royalty-free").

---

## 4. Places (package C)

- **MapLibre GL 5 + OpenFreeMap "positron" vector style**, no API key. Chosen over Leaflet +
  raster tiles because vector layers can be recoloured to the palette at runtime: after load, set
  background/land → Kalk `#F4F2EE`, water → `#DCE3E6` (Havglas mixed into Kalk), parks → `#E9E8E0`,
  roads → Papir/Tåge, labels → Sten, boundaries hidden. Loaded with dynamic `import()` only on the
  Places tab. Attribution kept, compact: "© OpenFreeMap © OpenMapTiles © OpenStreetMap".
- GeoJSON source of items with GPS, `cluster: true, clusterRadius: 40`. Clusters: Blæk circles with
  a mono count; single points: 10 px Fjord dots with a 2 px Papir ring. Cluster tap → zoom; point
  tap → `openViewer(id)`. Fit bounds with padding. Map 220 px mobile / 380 px wide, radius 20.
- If the style/tiles fail (offline), keep the list and show a quiet "Map unavailable offline".
- **List:** one row per known POI with items, then "Elsewhere in <city>", then "Other places" (0.01°
  grid, labelled by coordinates). Row: mono index in Eg, name, "Day 2 · 14 items" (or "Days 1–2"),
  2 (mobile) / 4 (wide) thumbnails. Tap → `goToDay(firstDay)`.
- No GPS at all: "No location data yet. Photos taken with location on show up here."

---

## 5. Day captions (package C)

In each trip-day header (B renders `<DayCaption day editable/>`): the caption in Sten 14 px with a
16 px avatar of whoever wrote it; none + editable → text button "Add a line about this day". Tap →
inline single-line input (max 140, Enter saves, Esc cancels, blur saves), optimistic, SSE to
others. Read-only in select mode. Nothing for before/after sections.

---

## 6. Frontend stack

- **Vite 7 + React 19 + TypeScript 5.9**, `base: '/photos/'`, alias `@shared/*` → `../shared/*`,
  `@/*` → `src/*`. Node 20.19+ on the host is fine for dev.
- **State:** zustand stores in `src/state/` (session, library + SSE, toast), done. Feature-local
  UI state stays in components or feature stores. No React Query: one library fetch + SSE deltas
  is simpler and always consistent.
- **Routing:** `src/lib/router.ts` (done): path tabs `/photos/`, `/photos/memories`,
  `/photos/places`; overlays as query params (`?item=`, `?memory=`, `?upload=1`, one-shot `?day=`)
  so the tab under an overlay stays mounted and the back button closes overlays.
- **Icons:** `@phosphor-icons/react`, weight light, size 22 via `IconContext` (App.tsx), curated
  exports in `src/lib/icons.ts`. No unicode glyph icons (×, ←, ★, ♥, ✓, ↓, ♪) in the UI.
- **Fonts:** self-hosted `@fontsource/instrument-sans` 400/500 and `@fontsource/geist-mono` 400/500
  (no Google request; works offline after first load).
- **CSS:** vanilla CSS. Tokens in `src/styles/tokens.css`, reset/utilities/keyframes in
  `src/styles/base.css` (both done, scaffold-owned). Components use CSS Modules
  (`X.module.css`) inside their feature folder. No Tailwind: the system is small and fully tokenised;
  modules keep packages from colliding. Grids always `minmax(0,1fr)`, never bare `1fr` tracks.
- **Grid performance:** no JS virtualisation. Tiles are fixed-aspect `<button>`s with
  `<img loading="lazy" decoding="async">` of `thumb.webp` over the `tone` colour; each day section
  gets `content-visibility: auto` with `contain-intrinsic-size` from its row count. This handles a
  few thousand items on current phones and keeps sticky headers and anchors trivial. Revisit only
  beyond ~3000 items.
- **Viewer:** dark (Nat), `display.webp` with the thumb as instant placeholder, neighbours
  preloaded, native `<video playsInline controls>` of `preview.mp4` with `display.webp` as poster.
- **Reduced motion:** tokens collapse durations, base.css kills animations; the player also skips
  Ken Burns (don't rely on the global rule there: `forwards` fill would snap to the zoomed end frame).
- **Breakpoint:** one, `(min-width: 900px)` = WIDE (`useWide()` in `src/lib/useMedia.ts`).

---

## 7. Mockup improvements adopted

1. **Honest mobile save:** Web Share two-step with real progress, never "Saved to Photos › Denmark
   2026". The prototype's album claim is impossible from a web app.
2. **Honest ZIP toast:** "Download started" + real count/size, exact Content-Length so the browser's
   own progress is real. The prototype's percentage was simulated.
3. **"Save video" cut, "Save these 12" instead** (see §3.1). Same intent, deliverable today.
4. **Song label says "generated ambient"**, not "royalty-free": it is synthesised in the browser.
5. **Upload copy tells the truth about background:** "You can close this. Keep fælles open until
   it's done." Browsers suspend background tabs; the prototype promised more than the web allows.
6. **Resumable queue with pending count** (designer's HIGH-value pick): rows show "Waiting for
   connection" / "Retrying", a mono count sits on the + button, Screen Wake Lock while uploading,
   `beforeunload` guard.
7. **Duplicate detection** (sha256): re-uploads on flaky networks become "Already in the album",
   not doubles.
8. **Before/After sections** instead of clamping into day 1/4.
9. **04:00 day boundary** so late nights stay with their evening.
10. **No planned place shown as if derived:** without GPS a day says "No location data".
11. **Library hero meta is computed** ("4 DAYS · 3 PLACES" from real data, days/places omitted when 0).
12. **"Denmark so far"** for the trip memory until all four days exist: the trip is live.
13. **Removed "Try 8 sample files"** (fake data).
14. **Tone underlay per tile** (dominant colour) instead of flat grey while thumbs load or process.
15. **Remove my upload + Undo** (designer's "worth adding"), own items only.
16. **Day captions** (designer's cheap pick).
17. **Phosphor Light icons with labels** replace unicode glyphs (×, ←, →, ★, ♥, ✓, ↓, ♪): consistent
    1.5 px geometry and real accessible names.
18. **Contrast fixes:** inactive tab labels and footer text use Sten (4.6:1) instead of `#8C8A84` /
    `#A9A69F` (≈3.2:1 / 2.4:1 on light).
19. **Keyboard and focus:** tiles are buttons, visible Fjord focus ring, Esc closes overlays, arrows in
    viewer/player, shift-click range selection on desktop.
20. **Viewer video uses the real player** (native controls on the H.264 preview) instead of faux
    controls; "Preparing video…" while the preview renders, original still downloadable.
21. **Failed previews are honest:** "Couldn't make a preview. The original is safe." with download.
22. **PIN lockout copy** from the server ("Too many tries. Try again in 2 min."), paste of a 4-digit
    code works on desktop.
23. **Density prop dropped;** the comfortable grid from the spec only.
24. No emoji, no decorative gradients (the only gradients are the spec's legibility scrims over photos
    on memory cards/player), blur only on the spec'd bars and the sheet scrim. No em dashes in new
    copy; the designer's en-dash date ranges ("25–28 September") stay.

---

## 8. Testing and verification

**Backend (package A, vitest):**
- Unit: `resolveCapture` table tests (every row of §1.5 with tag JSON fixtures), `stripBase`, PIN
  throttle (per-IP, doubling, global backoff, fake clock), zip entry naming/dedupe, sanitised names,
  `dayOf` via shared tests (`server/test/shared.test.ts`, 15 passing now).
- Integration (`buildApp({storageDir: tmp})`, real listen on a random port): login/throttle over HTTP,
  **end-to-end tus upload with `tus-js-client` (Node)** of real fixtures, both with and without the
  `/photos` prefix, asserting: byte-identical original (sha256), `dateSource` + `takenAt` + `day`,
  GPS, derived files exist, `item.added`/`item.updated` over SSE, duplicate upload returns the same
  item, zip Content-Length equals streamed bytes and unzips to identical bytes, delete/restore,
  hearts/highlight, caption. Tool-dependent tests `skipIf(!tools)` on the host and run for real in
  `docker build --target test .`.
- **Fixtures** (`server/scripts/make-fixtures.sh`, runs in a throwaway `alpine:3.20` + tools
  container, outputs committed to `server/test/fixtures/`, each < 1 MB): JPEG with
  `DateTimeOriginal 2026:09:26 14:03:11`, `OffsetTimeOriginal +02:00`, GPS Nyhavn; HEIC without
  offset + GPS Louisiana (`heif-enc` from `libheif-tools`, or `vips copy x.jpg x.heic`; if neither can
  encode, use libheif's public example `.heic` and write tags with exiftool); portrait JPEG with
  Orientation 6; PNG with no EXIF (→ `file`); HEVC `.mov` (libx265) with `Keys:CreationDate
  2026:09:28 11:04:00+02:00` + `Keys:GPSCoordinates` Kronborg; H.264 `.mp4` with only
  `QuickTime:CreateDate` (UTC) → `video-utc`; one 10-bit HLG HEVC clip to exercise tonemapping.
- `server/scripts/seed-dev.mjs`: uploads ~30 generated images + 3 clips across the 4 days, POIs and
  all four people through the real tus flow into the dev instance, and sets a few hearts/highlights/
  captions (dev storage only, never production).

**Web:** vitest for pure logic (C: `pickMemories`, place grouping, audio scheduler maths; B: upload
queue state machine, selection range, save-method choice).

**Visual (Playwright, `~/.venvs/playwright/bin/python`, helpers in `e2e/helpers.py`):**
390×844 (mobile, touch, DPR 2) and 1440×900. `e2e/b_core.py` (B) and `e2e/c_extras.py` (C) log in
through the real API, screenshot every screen/state they own into `e2e/out/`, and assert: no console
errors, no horizontal scroll, interactive elements ≥ 44 px in their smaller dimension (inline text
links excepted), dark viewer/player backgrounds. The orchestrator runs both against production
(`FAELLES_URL=http://127.0.0.1:8497/photos/`) and once through `scripts/strip-proxy.mjs` to prove the
stripped-prefix mode end to end (including an upload).

---

## 9. Work packages (three agents, same tree, at the same time)

### Ground rules for all packages
- Write **only** inside your OWNED paths. Everything else is read-only. Scaffold files
  (§11) are frozen; if you need a change there, or the contract seems wrong/missing, write it in
  your `notes/<A|B|C>.md` and work around it locally. Don't wait.
- **Do not commit, do not run git commands that write** (shared index). The orchestrator commits.
- `web/package.json` is frozen: all web deps are installed. Don't `npm install` in `web/`.
  the backend owns `server/package.json` and may add server deps.
- Web typecheck: `cd web && npx tsc -p tsconfig.app.json` (no build info written). Your acceptance
  is zero errors **in your own paths**; errors in another package's WIP are theirs.
- Ports: 8497 is production (don't leave anything on it). A's dev container: **8498**.
  B's Vite: **5181** (`VITE_CACHE_DIR=node_modules/.vite-b`), C's Vite: **5182** (`.vite-c`).
  Start Vite with `FAELLES_API=http://127.0.0.1:8498 npx vite --port 518x`. Stop what you start
  (dev container excepted, see A).
- Copy: sentence case, plain verbs, no em dashes, no emoji, errors say what happened and what to do.
- Every component: keyboard reachable, visible focus, `aria-label` on icon-only buttons, ≥ 44 px
  targets, `prefers-reduced-motion` respected, works at 390 px with a 16–20 px gutter.

### Backend — backend, media pipeline, container, docs
**Goal:** the complete server in §1 behind the exact `shared/api.ts` contract, containerised.
**OWNS:** `server/**` (incl. `package.json`, tests, fixtures, scripts), `Dockerfile`,
`docker-compose.yml`, `docker-compose.dev.yml`, `README.md`, `scripts/**`, `notes/A.md`.
**READS:** `shared/**`, `BRIEF.md`, `PLAN.md`, `web/` (only to build it in the Dockerfile).
**Milestone A1 (do first, then tell the others by writing `notes/A.md` "A1 READY"):** dev instance
`docker compose -p faelles-dev -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
on **127.0.0.1:8498** with `./storage-dev`, serving: session/PIN, library, tus upload + finalize +
exiftool, photo derivatives, media serving with Range, SSE, and the seed data loaded. Leave it
running (it is the shared dev backend); rebuild it as you go.
**Then A2:** video pipeline + HDR, ZIP, hearts/highlight/delete/restore/captions, throttling,
disk guard, CSP/headers, trash + incoming purge, README (run, backup, PIN change, funnel command,
troubleshooting), all tests.
**Suggested layout:** `src/index.ts` (boot), `src/app.ts` (`buildApp(config)`), `src/config.ts`,
`src/db/*.ts`, `src/auth/*.ts`, `src/routes/*.ts`, `src/upload/tus.ts`, `src/media/{capture,exif,
vips,ffmpeg,queue,tools}.ts`, `src/zip.ts`, `src/events.ts`, `src/disk.ts`.
**Acceptance:**
- Every endpoint/type/status in `shared/api.ts` implemented exactly (DTO fields never `undefined`).
- Works with and without `/photos` (tests + strip proxy), incl. tus Location.
- HEIC, JPEG, PNG, DNG (embedded preview), MOV HEVC (HDR → SDR), MP4 all produce derivatives;
  originals byte-identical.
- PIN: 5 wrong → 429 with Retry-After; global backoff works; right PIN during a per-IP lockout
  from another IP works.
- `docker compose up -d --build` → healthy on 127.0.0.1:8497 with `./storage`; restart re-enqueues
  processing items.
**Verify:** `cd server && npx tsc --noEmit && npm test`; `docker build --target test -t faelles-test . &&
docker run --rm faelles-test`; `curl -s 127.0.0.1:8498/photos/api/health`;
`node scripts/strip-proxy.mjs 8499 8498` + upload through `http://127.0.0.1:8499/photos/`.

### Frontend core — frontend core
**Goal:** everything a person touches to get photos in, browse them and get them out.
**OWNS:** `web/src/app/**` (Root, shell, top bar, tab bar, layout),
`web/src/features/auth/**` (PIN gate, Who's this), `web/src/features/library/**` (hero, filter chips,
day sections, grid, tiles, empty states, footer), `web/src/features/viewer/**`,
`web/src/features/select/**` (select mode, per-day select, selection bar/pill, size total),
`web/src/features/upload/**` (sheet/modal, drop zone incl. page-level drag on desktop, tus queue,
rows, pending badge), `web/src/features/toast/**` (ToastHost rendering `state/toast.ts`),
`web/src/lib/save.ts` (keep the exported signatures), `e2e/b_core.py`, `notes/B.md`.
**READS:** everything in the scaffold (§11) and C's slot modules (render them via `src/slots.ts`).
**Integration duties:** Root gates on `useSession().status` (`unknown` → blank Kalk, `locked` →
PIN, `needs-person` or `choosingPerson` → Who, `ready` → shell), then calls
`useLibrary.getState().load()` and `startLive()`. Shell renders tabs by `useRoute().tab` with
`MemoriesTab`/`PlacesTab` from `src/slots.ts` in `<Suspense>`, `<FeaturedMemoryCard/>` above the
chips, `<DayCaption day editable={!selectMode}/>` in trip-day headers, `<MemoryPlayer>` when
`route.memory`, viewer when `route.item`, upload when `route.upload`. Consumes `route.day`
(scroll to `#day-<key>` minus sticky offsets, then `clearDayTarget()`).
**Acceptance:**
- Screens 01–07 of the spec + desktop variants match the prototype's layout, sizes and copy
  (with the §7 improvements). Tab bar hidden in select mode (mobile); floating pill on desktop.
- Long-press 480 ms enters select; tap active chip clears it; per-day select; running size total.
- Upload survives: airplane-mode mid-file → "Waiting for connection" → resumes from offset on
  reconnect; reload + re-pick the same file → resumes (tus fingerprint); 401 mid-queue → PIN gate,
  resume after login. Done stage names the days from the server's items.
- Viewer: swipe (pointer, 50 px), ←/→/Esc, hearts with liker avatars, star, save/original per
  `saveMethodFor`, own-item "Remove from album" with Undo toast, video preview playback.
- Live: an upload from another browser context appears without reload.
**Verify:** `npx tsc -p tsconfig.app.json` (own paths clean), `npx vitest run src/features`,
`~/.venvs/playwright/bin/python e2e/b_core.py` (both viewports, all states, assertions pass).

### Frontend extras — frontend extras
**Goal:** Memories + player + generated ambient audio, Places + map, day captions.
**OWNS:** `web/src/features/memories/**` (incl. `MemoriesTab.tsx`, `MemoryPlayer.tsx`,
`FeaturedMemoryCard.tsx`, `pickMemories.ts`, `audio/**`), `web/src/features/places/**`
(incl. `PlacesTab.tsx`, map style recolouring, place grouping), `web/src/features/captions/**`
(incl. `DayCaption.tsx`), `e2e/c_extras.py`, `notes/C.md`.
**READS:** the scaffold (§11), `design/`, `shared/`. Uses `saveItems()` from `lib/save.ts` (B owns;
the signature is fixed) and the toast store.
**Contract with B:** keep the export names/default exports and prop types from `src/slots.ts`.
`FeaturedMemoryCard` returns `null` when nothing qualifies. `MemoryPlayer` is fixed/fullscreen at
`z-index: var(--z-player)`, handles its own keys and calls `onClose`.
**Acceptance:**
- Memories and eligibility exactly as §3; empty state with real numbers; featured card as §3.
- Player: segments, tap zones, title card, Ken Burns (off under reduced motion), pause on hidden tab,
  keys, ended screen with Replay + "Save these N"; audio per §3.2 with mood per memory, Change,
  mute persisted, clean teardown (no audio after close, no leaked contexts after 5 opens).
- Places: recoloured MapLibre map (lazy chunk), clusters, list grouped as §4, row → library day,
  offline fallback, empty state.
- Captions: inline edit per §5, optimistic, 140 chars, SSE updates.
**Verify:** `npx tsc -p tsconfig.app.json` (own paths clean), `npx vitest run src/features/memories
src/features/places`, `~/.venvs/playwright/bin/python e2e/c_extras.py`.

---

## 10. Open questions for the orchestrator / user

1. **Edi's Sony α7C clock**: cameras keep whatever zone they were set to (maybe Romania, UTC+3) and
   write no offset, so its photos may sort an hour late. Cheap fix if it happens: a per-camera
   offset correction (not built now).
2. **Global PIN backoff can lock friends out for 15 min** if someone hammers the URL. Existing
   sessions keep working (90-day cookie), so only new devices are affected. Acceptable?
3. **Trash retention** 30 days, no purge UI. Fine for now?
4. **Map tiles come from OpenFreeMap** (third-party request from viewers' phones, no key, no
   tracking cookies). OK privacy-wise, or would they rather have no basemap?

---

## 11. Scaffold (exists now, compiles; frozen, owned by the orchestrator)

```
.gitignore .dockerignore PLAN.md BRIEF.md
shared/api.ts        full HTTP/SSE contract, limits, path builders, file-type helpers
shared/trip.ts       people, trip, days, POIs, cities, tz helpers, dayOf, nearestPoi, cityOf, deriveDay
shared/format.ts     formatBytes, formatDuration, formatDateLine, formatCoords, plural
server/package.json tsconfig.json vitest.config.ts src/index.ts (stub with stripBase)
server/test/shared.test.ts            (package A may extend; don't delete)
web/package.json tsconfig*.json vite.config.ts index.html
web/src/main.tsx App.tsx vite-env.d.ts slots.ts
web/src/styles/tokens.css base.css
web/src/lib/api.ts router.ts icons.ts useMedia.ts
web/src/state/session.ts library.ts toast.ts
web/src/ui/Button.tsx Button.module.css Avatar.tsx Wordmark.tsx index.ts
web/src/app/Root.tsx                  STUB → package B replaces
web/src/lib/save.ts                   minimal working version → package B completes
web/src/features/memories/{MemoriesTab,MemoryPlayer,FeaturedMemoryCard}.tsx   STUBS → package C
web/src/features/places/PlacesTab.tsx                                          STUB → package C
web/src/features/captions/DayCaption.tsx                                       STUB → package C
e2e/helpers.py
```

Exception to "frozen": `server/src/index.ts` and `server/package.json` belong to A;
`web/src/app/Root.tsx` + `web/src/lib/save.ts` to B; the five feature stubs to C.
