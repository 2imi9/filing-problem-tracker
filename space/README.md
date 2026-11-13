---
title: Filing Problem Tracker
colorFrom: blue
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: Why court filings without a lawyer get rejected
---

# Filing Problem Tracker

Student prototype for Northeastern CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. All data is made up, and it gives no legal advice.

Code and docs: https://github.com/2imi9/filing-problem-tracker

AI comes from [OpenJev Flash 9B](https://huggingface.co/openjev/OpenJev-Flash-9B-GGUF), which runs inside this Space. On Tag a filing it suggests a problem while a clerk types a note; on Import it sorts the rows the keyword rules cannot. Each AI tag is labelled "OpenJev (AI)" with a short reason picked from a fixed list, and the clerk accepts or changes every suggestion. Names and case numbers are taken out of a note before it is sent. The dashboard uses no AI. The model weights are CC BY-NC 4.0 (non-commercial use, with attribution). OpenJev is an independent project.
