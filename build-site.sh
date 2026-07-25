#!/usr/bin/env bash
# Builds a clean ./site/ folder containing ONLY the files the live website needs.
# Drag the resulting ./site/ folder onto Netlify (app.netlify.com/drop) to deploy.
# Re-run this any time you change the source files.
set -euo pipefail
shopt -s nullglob   # empty globs expand to nothing instead of a literal pattern
cd "$(dirname "$0")"

OUT="site"
rm -rf "$OUT"
mkdir -p "$OUT/testimonials"

# Copy files matching a glob into a dir, skipping silently if none exist.
copy_glob() { local dest="${!#}"; local files=("${@:1:$#-1}"); [ ${#files[@]} -gt 0 ] && cp "${files[@]}" "$dest"; return 0; }

# --- Core pages / code / styles ---
cp index.html scheduling.html scheduling.js script.js styles.css "$OUT/"

# --- Images used by the pages ---
cp Cosmic_Healing_Light.jpg goddess-in-white.jpeg "$OUT/"

# --- Testimonial chat screenshot ---
cp testimonials/baby-rash-chat.png "$OUT/testimonials/"

# --- Letter images (deck/carousel) — images only, skip the .docx source files ---
mkdir -p "$OUT/testimonials/text"
copy_glob testimonials/text/*.jpg "$OUT/testimonials/text/"
copy_glob testimonials/text/*.png "$OUT/testimonials/text/"

# --- All videos (testimonials, Robin Jay interview, and the earth-energy clip)
#     now live on YouTube and embed as iframes. No video files ship at all. ---

# --- Tidy: strip any macOS metadata that may have tagged along ---
find "$OUT" -name '.DS_Store' -delete

echo "Built ./$OUT/ ($(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1))"
echo "Deploy: drag the '$OUT' folder onto https://app.netlify.com/drop"
