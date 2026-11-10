#!/usr/bin/env sh
# Builds the static demo site that Render publishes: the single-file
# prototype wrapped in a complete HTML document.
set -eu
mkdir -p site
{
  printf '%s\n' '<!doctype html>' '<html lang="en">' '<head>' '<meta charset="utf-8">' '<meta name="viewport" content="width=device-width, initial-scale=1">'
  cat docs/prototype/filing_tracker.html
} > site/index.html
echo "Built site/index.html"
