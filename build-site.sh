#!/usr/bin/env bash
# Builds a clean ./site/ folder containing ONLY the files the live website needs.
# Drag the resulting ./site/ folder onto Netlify (app.netlify.com/drop) to deploy.
# Re-run this any time you change the source files.
set -euo pipefail
shopt -s nullglob   # empty globs expand to nothing instead of a literal pattern
cd "$(dirname "$0")"

OUT="site"
rm -rf "$OUT"
mkdir -p "$OUT"

# Copy files matching a glob into a dir, skipping silently if none exist.
copy_glob() { local dest="${!#}"; local files=("${@:1:$#-1}"); [ ${#files[@]} -gt 0 ] && cp "${files[@]}" "$dest"; return 0; }

# --- Core pages / code / styles ---
cp index.html scheduling.html scheduling.js script.js styles.css "$OUT/"

# --- Testimonials admin page (data lives in Netlify Blobs; see netlify/functions) ---
cp admin.html admin.css admin.js testimonials.js "$OUT/"
cp netlify/lib/youtube.mjs "$OUT/youtube.mjs"

# --- Images used by the pages ---
cp Cosmic_Healing_Light.jpg goddess-in-white.jpeg "$OUT/"

# --- Testimonial images (letters, chat screenshot) now live in Netlify Blobs and
#     are managed at /admin. The source files stay in testimonials/ for the
#     one-time import (scripts/import-testimonials.mjs). ---

# --- All videos (testimonials, Robin Jay interview, and the earth-energy clip)
#     now live on YouTube and embed as iframes. No video files ship at all. ---

# --- Tidy: strip any macOS metadata that may have tagged along ---
find "$OUT" -name '.DS_Store' -delete

echo "Built ./$OUT/ ($(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1))"
echo "Deploy: use the project 'deploy' skill (Netlify CLI, site touch-the-world)"
