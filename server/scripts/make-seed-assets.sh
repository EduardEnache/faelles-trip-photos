#!/bin/sh
# Generates the raw seed media (photos + a few video clips) used by
# seed-dev.mjs, with varied EXIF/QuickTime dates and GPS across the trip's
# POIs and people. Dates are computed relative to "now" (not hardcoded
# 2026-09-25..28): resolveCapture ignores EXIF more than 2 days in the future
# (PLAN.md §1.5), and since the trip is live, "day 4" simply doesn't have
# real photos until day 4 actually happens — that's correct, not a bug.
#
# Runs itself inside alpine:3.20 + vips-tools/vips-heif/ffmpeg/exiftool if
# those aren't already on PATH (same pattern as make-fixtures.sh).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_OUT="$SCRIPT_DIR/.seed-assets"
OUT_DIR="${OUT_DIR:-$DEFAULT_OUT}"

if ! command -v vips >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1 || ! command -v exiftool >/dev/null 2>&1; then
  mkdir -p "$OUT_DIR"
  echo "make-seed-assets: running inside alpine:3.20 + tools..."
  exec docker run --rm \
    -v "$OUT_DIR:/out" \
    -v "$SCRIPT_DIR/make-seed-assets.sh:/make-seed-assets.sh:ro" \
    -e OUT_DIR=/out \
    alpine:3.20 \
    sh -c "apk add --no-cache vips-tools vips-heif ffmpeg exiftool >/dev/null 2>&1 && sh /make-seed-assets.sh"
fi

mkdir -p "$OUT_DIR"
find "$OUT_DIR" -mindepth 1 -delete
cd "$OUT_DIR"
MANIFEST="manifest.tsv"
: > "$MANIFEST"

NOW=$(date -u +%s)
dayEpoch() { echo $((NOW + 86400 * $1)); }   # $1 = 0 today, 1 tomorrow, 2 day-after, -1 yesterday
ymd() { date -u -d "@$1" "+%Y:%m:%d"; }

PEOPLE="alex sam chris edi"
n=0

photo() {
  # $1 dateYmd  $2 time HH:MM:SS  $3 tzOrEmpty (e.g. +02:00, empty = no offset)
  # $4 lat $5 lon  $6 make $7 model  $8 person  $9 seed
  n=$((n + 1))
  local f="p$(printf '%03d' "$n").jpg"
  vips gaussnoise _t.v 640 480 --sigma "$((20 + n % 40))" --mean "$((90 + n % 60))" --seed "$n"
  vips copy _t.v "$f"
  rm -f _t.v
  if [ -n "$3" ]; then
    exiftool -overwrite_original -q -n \
      -EXIF:DateTimeOriginal="$1 $2" -EXIF:OffsetTimeOriginal="$3" \
      -GPSLatitudeRef=N -GPSLatitude="$4" -GPSLongitudeRef=E -GPSLongitude="$5" \
      -Make="$6" -Model="$7" "$f"
  else
    exiftool -overwrite_original -q -n \
      -EXIF:DateTimeOriginal="$1 $2" \
      -GPSLatitudeRef=N -GPSLatitude="$4" -GPSLongitudeRef=E -GPSLongitude="$5" \
      -Make="$6" -Model="$7" "$f"
  fi
  printf '%s\tphoto\t%s\n' "$f" "$8" >> "$MANIFEST"
}

video() {
  # $1 dateYmd $2 time $3 tz $4 lat $5 lon $6 model $7 person $8 useZone(1|0)
  n=$((n + 1))
  local f="v$(printf '%03d' "$n").mov"
  ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=2:size=640x480:rate=15 -c:v libx265 -pix_fmt yuv420p -t 2 "$f"
  if [ "$8" = "1" ]; then
    exiftool -overwrite_original -q -n \
      -Keys:CreationDate="$1 $2$3" -Keys:GPSCoordinates="$4 $5" -Keys:Model="$6" "$f"
  else
    exiftool -overwrite_original -q -n -QuickTime:CreateDate="$1 $2" "$f"
  fi
  printf '%s\tvideo\t%s\n' "$f" "$7" >> "$MANIFEST"
}

# ── "before the trip": arrival, yesterday, Kastrup ──
D=$(ymd "$(dayEpoch -1)")
photo "$D" "19:40:00" "+02:00" 55.6180 12.6508 "Apple" "iPhone 16 Pro" alex 1
photo "$D" "20:05:00" "+02:00" 55.6180 12.6508 "samsung" "SM-S928B" sam 2

# ── trip days 0/1/2 (today / tomorrow / day-after): København → Humlebæk ──
i=0
for day in 0 1 2; do
  D=$(ymd "$(dayEpoch "$day")")
  if [ "$day" = 0 ]; then CITY_POIS="55.6798,12.5911 55.6737,12.5681"      # Nyhavn, Tivoli
  elif [ "$day" = 1 ]; then CITY_POIS="55.6809,12.5775 55.6736,12.5941"   # Rundetårn, Christianshavn
  else CITY_POIS="55.9690,12.5429 55.9622,12.5390"; fi                    # Louisiana, Humlebæk Havn
  for person in $PEOPLE; do
    for poi in $CITY_POIS; do
      lat=${poi%,*}; lon=${poi#*,}
      h=$((9 + i % 9)); m=$(((i * 7) % 60))
      i=$((i + 1))
      if [ $((i % 3)) = 0 ]; then
        # older-Samsung style: no offset tag → exif-local fallback
        photo "$D" "$(printf '%02d:%02d:00' "$h" "$m")" "" "$lat" "$lon" "samsung" "SM-G991B" "$person" "$i"
      else
        mk="Apple"; md="iPhone 16 Pro"
        [ $((i % 2)) = 0 ] && { mk="samsung"; md="SM-S928B"; }
        photo "$D" "$(printf '%02d:%02d:00' "$h" "$m")" "+02:00" "$lat" "$lon" "$mk" "$md" "$person" "$i"
      fi
    done
  done
  # one video per trip day, alternating iPhone-zoned / Samsung-UTC
  lat=$(echo "$CITY_POIS" | cut -d' ' -f1 | cut -d, -f1)
  lon=$(echo "$CITY_POIS" | cut -d' ' -f1 | cut -d, -f2)
  if [ "$day" = 2 ]; then
    video "$D" "14:00:00" "" "$lat" "$lon" "" "chris" 0
  else
    video "$D" "14:00:00" "+02:00" "$lat" "$lon" "iPhone 16 Pro" "edi" 1
  fi
done

echo "make-seed-assets: $n assets in $OUT_DIR"
wc -l "$MANIFEST"
