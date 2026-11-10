#!/usr/bin/env sh
# Collects the files for the Hugging Face Space into space-build/, all in one
# folder so they can be dragged into the Space's Files tab in one go.
set -eu
cd "$(dirname "$0")/.."
rm -rf space-build
mkdir -p space-build
cp space/README.md space/Dockerfile space/server.py docs/assets/courthouse-ascii-hero.jpg docs/assets/mark.svg space-build/
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' '<meta charset="utf-8">' '<meta name="viewport" content="width=device-width, initial-scale=1">'
  sed 's#\.\./assets/##g' docs/prototype/filing_tracker.html
} > space-build/index.html
echo "Built space-build/"
