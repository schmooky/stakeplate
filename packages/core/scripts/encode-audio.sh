#!/usr/bin/env bash
# encode-audio.sh — turn raw game audio (wav/aiff/flac/…) into shippable web assets.
#
# For every input it emits a webm/opus + mp3 pair (same basename) so the game can load a
# codec ladder — `{ url: ['clip.webm', 'clip.mp3'] }` — with Opus on Chrome/Android and the
# mp3 fallback on iOS Safari (which can't decodeAudioData Opus). ALL metadata is stripped:
# no encoder/date/source tags leak into the shipped bundle (the only residue is the generic
# `encoder=Lavf` matroska muxer tag, which every ffmpeg webm carries and reveals nothing).
#
# Loudness is intentionally NOT touched here — level one-shots at LOAD time with the mixer's
# zvuk RMS normalizer instead (consistent across the whole manifest), not per file.
#
# Usage:
#   scripts/encode-audio.sh OUTDIR INPUT...
#   scripts/encode-audio.sh src/assets/audio raw/*.wav
#
# Env:
#   OPUS_KBPS   opus bitrate (default 96)
#   MP3_QUALITY libmp3lame -q:a VBR quality, 0=best..9 (default 5)
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 OUTDIR INPUT..." >&2
  exit 2
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found on PATH" >&2; exit 1; }

OUT="$1"; shift
mkdir -p "$OUT"
OPUS_KBPS="${OPUS_KBPS:-96}"
MP3_QUALITY="${MP3_QUALITY:-5}"

# Strip every metadata/chapter tag + force bit-exact muxing (no creation-time / encoder tags).
STRIP=(-map_metadata -1 -map_chapters -1 -fflags +bitexact -flags:a +bitexact -id3v2_version 0 -write_id3v1 0 -write_xing 0)

for in in "$@"; do
  [ -f "$in" ] || { echo "skip (not a file): $in" >&2; continue; }
  base="$(basename "${in%.*}")"
  ffmpeg -y -loglevel error -i "$in" -c:a libopus -b:a "${OPUS_KBPS}k" -vbr on "${STRIP[@]}" "$OUT/$base.webm"
  ffmpeg -y -loglevel error -i "$in" -c:a libmp3lame -q:a "$MP3_QUALITY"   "${STRIP[@]}" "$OUT/$base.mp3"
  echo "ok  $base  ->  $OUT/$base.{webm,mp3}"
done
