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

AI comes from [Kev-0.8B](https://huggingface.co/jaredpalmer/kev-0.8b) (Apache-2.0, on Qwen3.5-0.8B-Base, Apache-2.0), which runs inside this Space on the CPU. On Tag a filing it suggests a problem while a clerk types a note; on Import it sorts the rows the keyword rules cannot. It picks a problem and a reason from a fixed list and writes nothing of its own. Each AI tag is labelled "Kev (AI)". The clerk accepts or changes every suggestion. Names and case numbers are taken out of a note before it is sent. The dashboard uses no AI: its chat panel is a preview of a proposed AI feature, written by code from the counts. Kev is an independent project by Jared Palmer.
