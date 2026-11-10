# Quickstart: Filing Problem Tracker

## Run the prototype

```bash
sh scripts/build-site.sh
open site/index.html
```

## Run with the local model (optional)

Needs an Apple silicon Mac with 16 GB of memory. The first run downloads about 9.5 GB.

```bash
sh scripts/start-openjev.sh       # terminal 1: OpenJev Flash 9B on 127.0.0.1:3000
python3 scripts/serve-local.py    # terminal 2: the tracker on http://localhost:8080
```

The Import tab says whether the model is ready. Rows the keyword rules cannot sort go to the model and come back marked "OpenJev (AI)", or "OpenJev (AI) was not sure" if it left them for review. Stop terminal 1 and Import falls back to the rules alone. For a Mac with less memory, start the model with `OPENJEV_MODEL=openjev/OpenJev-Flash-9B-MLX-4bit` (about 5 GB).

## Run on a Hugging Face Space (optional)

One free Docker Space serves the page and the model together (the 5.6 GB build on llama.cpp, no GPU, so each leftover row takes a while).

```bash
sh scripts/build-space.sh   # collects six files into space-build/
```

Create a Space with the Docker SDK and upload the six files. The first build downloads the model.

## Check it works

1. On Tag a filing, pick a form, click two problems and save. The entry appears in Recent entries.
2. On Dashboard, the count of flagged filings has gone up by one.
3. On Import, sort the sample export and add the rows. Two rows are marked "Needs review". With the model running, it sorts one of them and the tab says what it did.
4. On Dashboard, change the county filter. Every panel changes.
5. In Before and after a change, pick a change. The rate after the change is lower than before.
