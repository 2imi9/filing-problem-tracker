#!/usr/bin/env sh
# Runs OpenJev Flash 9B on this Mac (Apple silicon) at 127.0.0.1:3000.
# The first run downloads the model into .openjev/ (about 9.5 GB). The commands and
# pinned versions follow the model card: https://huggingface.co/openjev/OpenJev-Flash-9B-MLX
# For a Mac with less memory: OPENJEV_MODEL=openjev/OpenJev-Flash-9B-MLX-4bit (about 5 GB).
set -eu
MODEL="${OPENJEV_MODEL:-openjev/OpenJev-Flash-9B-MLX}"
PORT="${OPENJEV_PORT:-3000}"
cd "$(dirname "$0")/.."
mkdir -p .openjev
cd .openjev
DIR="$(basename "$MODEL")"
PACKAGES="mlx==0.32.2 mlx-lm==0.31.3 transformers==5.17.0 openai==3.16.2 httpx==0.28.1 huggingface-hub==1.32.0"

if [ ! -x venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then uv venv venv --python 3.12; else python3 -m venv venv; fi
fi
if command -v uv >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  uv pip install --quiet --python venv/bin/python $PACKAGES
else
  # shellcheck disable=SC2086
  venv/bin/python -m pip install --quiet $PACKAGES
fi

venv/bin/hf download "$MODEL" --local-dir "$DIR"
venv/bin/hf download openjev/OpenJev-Flash-9B helper/shim.py helper/shim_mlx.py --local-dir api

# The five READOUT_* values are this model's calibration; the helper's defaults belong to the larger model.
TOKENIZER="$DIR" SHIM_MODEL="$DIR" \
READOUT_T=1.07 READOUT_NOUL_T=1.074766 READOUT_NOUL_BIAS=0 \
READOUT_TARGETED=1 READOUT_INSTR_STYLE=pyrepr SHIM_STAGGER=1 \
  exec venv/bin/python api/helper/shim_mlx.py --helper api/helper/shim.py --model "$DIR" \
  --host 127.0.0.1 --port "$PORT" "$@"
