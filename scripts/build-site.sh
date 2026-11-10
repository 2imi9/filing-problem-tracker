#!/usr/bin/env sh
# Builds the static demo site that Render publishes: the single-file
# prototype wrapped in a complete HTML document, plus its header image and mark.
set -eu
mkdir -p site/assets
cp docs/assets/hero-ascii.png docs/assets/mark.svg site/assets/
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' '<meta charset="utf-8">' '<meta name="viewport" content="width=device-width, initial-scale=1">'
  sed 's#\.\./assets/#assets/#g' docs/prototype/filing_tracker.html
} > site/index.html
echo "Built site/index.html"
