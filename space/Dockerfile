# Hugging Face Space: the tracker page and Kev-0.8B in one container, on the free CPU.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
# CPU-only torch first, so installing Kev does not pull the much larger CUDA build.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.6,<2.9" \
 && pip install --no-cache-dir "kev[serve] @ git+https://github.com/jaredpalmer/kev.git@kev-1.0"
# Kev-0.8B and its Qwen3.5-0.8B-Base backbone (both Apache-2.0), about 1.6 GB, loaded once here so the
# files are in the image and a restart needs no download.
ENV HF_HOME=/srv/hf KEV_RUN=jaredpalmer/kev-0.8b@v1.0
RUN python -c "import os; from kev.checkpoint import Checkpoint; Checkpoint(os.environ['KEV_RUN']).load('cpu')" \
 && chown -R 1000:1000 /srv/hf
WORKDIR /srv
COPY --chown=1000:1000 server.py index.html courthouse-ascii-hero.jpg mark.svg /srv/
USER 1000
ENV HOME=/tmp HF_HUB_OFFLINE=1
EXPOSE 7860
CMD ["python", "/srv/server.py"]
