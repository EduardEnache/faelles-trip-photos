#!/bin/sh
# Generates server/test/fixtures/* used by the integration tests
# (PLAN.md §8). Synthetic images/video (no network needed) with real EXIF/
# QuickTime metadata written by exiftool, covering the phones that will
# actually be used on this trip: iPhone and Samsung. No Sony.
#
# Runs itself inside a throwaway alpine:3.20 + vips-tools/vips-heif/ffmpeg/
# exiftool container (same versions verified in BRIEF.md) if those tools
# aren't already on PATH, so it works the same on the host or in CI.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_OUT="$SCRIPT_DIR/../test/fixtures"
OUT_DIR="${OUT_DIR:-$DEFAULT_OUT}"
mkdir -p "$OUT_DIR"

if ! command -v vips >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1 || ! command -v exiftool >/dev/null 2>&1; then
  echo "make-fixtures: vips/ffmpeg/exiftool not on PATH, running inside alpine:3.20 + tools..."
  exec docker run --rm \
    -v "$OUT_DIR:/out" \
    -v "$SCRIPT_DIR/make-fixtures.sh:/make-fixtures.sh:ro" \
    -e OUT_DIR=/out \
    alpine:3.20 \
    sh -c "apk add --no-cache vips-tools vips-heif ffmpeg exiftool >/dev/null 2>&1 && sh /make-fixtures.sh"
fi

cd "$OUT_DIR"
echo "make-fixtures: writing into $OUT_DIR"

# ── 1. iPhone JPEG: DateTimeOriginal + OffsetTimeOriginal, GPS Nyhavn ──
vips gaussnoise _t.v 640 480 --sigma 40 --mean 130 --seed 1
vips copy _t.v jpeg-iphone-nyhavn.jpg
rm -f _t.v
exiftool -overwrite_original -q -n \
  -EXIF:DateTimeOriginal="2026:09:26 14:03:11" \
  -EXIF:SubSecTimeOriginal="420" \
  -EXIF:OffsetTimeOriginal="+02:00" \
  -EXIF:CreateDate="2026:09:26 14:03:11" \
  -GPSLatitudeRef=N -GPSLatitude=55.6798 \
  -GPSLongitudeRef=E -GPSLongitude=12.5911 \
  -Make="Apple" -Model="iPhone 16 Pro" \
  -FocalLengthIn35mmFormat=24 -FNumber=1.8 -ExposureTime=0.004166 -ISO=64 \
  jpeg-iphone-nyhavn.jpg

# ── 2. Samsung JPEG, recent One UI (OffsetTimeOriginal present), portrait Orientation 6 ──
vips gaussnoise _t.v 640 480 --sigma 35 --mean 120 --seed 2
vips copy _t.v jpeg-samsung-modern-portrait.jpg
rm -f _t.v
exiftool -overwrite_original -q -n \
  -EXIF:DateTimeOriginal="2026:09:27 10:15:00" \
  -EXIF:OffsetTimeOriginal="+02:00" \
  -IFD0:Orientation=6 \
  -GPSLatitudeRef=N -GPSLatitude=55.9690 \
  -GPSLongitudeRef=E -GPSLongitude=12.5429 \
  -Make="samsung" -Model="SM-S928B" \
  -FocalLengthIn35mmFormat=26 -FNumber=1.8 -ExposureTime=0.008 -ISO=100 \
  jpeg-samsung-modern-portrait.jpg

# ── 3. Samsung JPEG, older One UI (no OffsetTimeOriginal) → Copenhagen wall-time fallback ──
vips gaussnoise _t.v 800 600 --sigma 30 --seed 3
vips copy _t.v jpeg-samsung-older-nooffset.jpg
rm -f _t.v
exiftool -overwrite_original -q -n \
  -EXIF:DateTimeOriginal="2026:09:25 09:30:00" \
  -Make="samsung" -Model="SM-G991B" \
  jpeg-samsung-older-nooffset.jpg

# ── 4. PNG, no EXIF at all → dateSource falls back to file/upload ──
vips gaussnoise _t.v 400 300 --sigma 25 --seed 4
vips copy _t.v png-no-exif.png
rm -f _t.v

# ── 5. iPhone HEIC: offset present, GPS Louisiana ──
vips gaussnoise _t.v 640 480 --sigma 35 --mean 128 --seed 5
if vips copy _t.v heic-iphone-louisiana.heic 2>/tmp/heic-err.log; then
  exiftool -overwrite_original -q -n \
    -EXIF:DateTimeOriginal="2026:09:27 13:20:00" \
    -EXIF:OffsetTimeOriginal="+02:00" \
    -GPSLatitudeRef=N -GPSLatitude=55.9690 \
    -GPSLongitudeRef=E -GPSLongitude=12.5429 \
    -Make="Apple" -Model="iPhone 15" \
    heic-iphone-louisiana.heic || echo "make-fixtures: exiftool couldn't write HEIC tags (ok, see notes/A.md)"
else
  echo "make-fixtures: no HEIC encoder available, skipping heic-iphone-louisiana.heic (see notes/A.md)"
fi
rm -f _t.v

# ── 6. iPhone HEVC .mov: Keys:CreationDate (with offset) present ALONGSIDE a
#       different QuickTime:CreateDate (UTC) — proves CreationDate wins. GPS Kronborg.
#       Date is computed as "1 day from now" (not hardcoded): resolveCapture
#       ignores dates more than 2 days in the future (PLAN.md §1.5), and this
#       script may run on any day during (or before/after) the actual trip. ──
NOW_EPOCH=$(date -u +%s)
TOMORROW=$(date -u -d "@$((NOW_EPOCH + 86400))" "+%Y:%m:%d")
ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=2:size=640x480:rate=15 \
  -c:v libx265 -pix_fmt yuv420p -t 2 mov-iphone-hevc-kronborg.mov
exiftool -overwrite_original -q -n \
  -QuickTime:CreateDate="$TOMORROW 06:00:00" \
  -Keys:CreationDate="$TOMORROW 11:04:00+02:00" \
  -Keys:GPSCoordinates="56.0390 12.6212" \
  -Keys:Model="iPhone 16 Pro" \
  mov-iphone-hevc-kronborg.mov
echo "$TOMORROW 09:04:00" > .kronborg-expected-utc-date
echo "make-fixtures: mov-iphone-hevc-kronborg.mov Keys:CreationDate → $TOMORROW 09:04:00 UTC (see .kronborg-expected-utc-date)"

# ── 7. Samsung H.264 .mp4: only QuickTime:CreateDate (UTC per spec) → video-utc ──
ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=2:size=640x480:rate=15 \
  -c:v libx264 -pix_fmt yuv420p -t 2 mp4-samsung-h264.mp4
exiftool -overwrite_original -q -n -QuickTime:CreateDate="2026:09:26 08:00:00" mp4-samsung-h264.mp4

# ── 8. 10-bit HLG HEVC clip, to exercise HDR→SDR tonemapping ──
ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=2:size=640x480:rate=15 \
  -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc \
  -c:v libx265 -profile:v main10 -t 2 mov-hlg-hevc.mov

# ── 9. Samsung Motion Photo shape: a real JPEG immediately followed by an MP4
#       trailer. Must not break exif/vips (they read up to the JPEG EOI and
#       ignore the trailer). ──
cat jpeg-samsung-modern-portrait.jpg mp4-samsung-h264.mp4 > jpeg-samsung-motionphoto.jpg

echo "make-fixtures: done"
ls -la "$OUT_DIR"
