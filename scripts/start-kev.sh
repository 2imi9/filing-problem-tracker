#!/usr/bin/env sh
# Starts a Kev decision model on this computer at 127.0.0.1:8009, for scripts/score-tagging.py.
# Kev (https://github.com/jaredpalmer/kev, Apache-2.0) answers the same /v1/systemone question as OpenJev.
# Needs git and uv (https://docs.astral.sh/uv/). The first run downloads the code and the model.
#   sh scripts/start-kev.sh                               # Kev-0.8B, any Apple silicon Mac
#   KEV_MODEL=jaredpalmer/kev-4b@v1.0 sh scripts/start-kev.sh   # more accurate, wants a 32 GB Mac
set -eu
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo "Install uv first: https://docs.astral.sh/uv/getting-started/installation/" >&2; exit 1; }
[ -d .kev/.git ] || git clone --depth 1 --branch kev-1.0 https://github.com/jaredpalmer/kev.git .kev
cd .kev
uv sync --extra serve
exec uv run --extra serve python -m kev.serve --run "${KEV_MODEL:-jaredpalmer/kev-0.8b@v1.0}" --port "${KEV_PORT:-8009}"
