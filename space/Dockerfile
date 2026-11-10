# Hugging Face Space: the tracker page and OpenJev Flash 9B (llama.cpp, CPU) in one container.
FROM ghcr.io/ggml-org/llama.cpp:server
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
# About 5.6 GB. Weights are CC BY-NC 4.0: https://huggingface.co/openjev/OpenJev-Flash-9B-GGUF
ADD --chown=1000:1000 https://huggingface.co/openjev/OpenJev-Flash-9B-GGUF/resolve/main/OpenJev-Flash-9B-Q4_K_M.gguf /models/openjev-flash-9b-q4.gguf
WORKDIR /srv
COPY --chown=1000:1000 server.py index.html courthouse-ascii-hero.jpg mark.svg /srv/
USER 1000
ENV HOME=/tmp
EXPOSE 7860
ENTRYPOINT []
CMD ["python3", "/srv/server.py"]
