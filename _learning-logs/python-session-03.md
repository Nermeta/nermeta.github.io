---
title: "Python S03: Threading the Scanner"
date: 2026-09-05
type: learning-log
domain: scripting
status: completed
requires: [python-session-02]
tags: [python, scripting, threading, performance]
audience: [tech]
summary: "Added threading to the port scanner with a queue. Scanning 1000 ports went from 16s to under 1s."
public: true
---

## What I Did

Revisited yesterday's TCP scanner and added a thread pool using `concurrent.futures.ThreadPoolExecutor`.

## What Clicked

The speedup was dramatic and immediately satisfying. Scanning 1–1000 on localhost:
- Sequential: ~16 seconds
- 100 threads: ~0.4 seconds

## Gotcha

Too many threads caused connection refused errors — the OS was hitting its own limits. Settled on 200 as a sweet spot.

## Next Time

Parse the output into something structured (dict or JSON) instead of printing to stdout.
