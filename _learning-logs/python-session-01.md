---
title: "Python S01: Environment Setup"
date: 2026-09-01
type: learning-log
parent: python-for-security
domain: scripting
status: completed
requires: [python-for-security]
tags: [python, scripting, environment, venv]
audience: [tech]
summary: "Got Python 3.12 set up properly with venv, pip, and VS Code. Ran first script. Figured out why PATH was broken."
public: true
---

## What I Did

First session getting my Python environment sorted. VS Code kept pointing at the wrong interpreter — turns out I had three Python installs competing.

- Installed Python 3.12 fresh
- Set up a dedicated `venv` for security scripting
- Configured VS Code to use it
- Wrote a 10-line "port scanner" skeleton just to confirm everything ran

## What Clicked

`venv` is just a folder containing a clean Python install. That finally made sense when I saw the directory structure.

## Still Fuzzy

- Why pip sometimes installs globally even inside a venv (permissions thing, I think)
