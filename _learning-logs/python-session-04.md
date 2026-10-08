---
title: "Python S04: Banner Grabbing"
date: 2026-09-08
type: learning-log
domain: scripting
status: in-progress
requires: [python-session-03]
tags: [python, scripting, recon, banner-grabbing]
audience: [tech]
summary: "Extended the scanner to grab service banners from open ports. Got it working for SSH and HTTP, still fighting FTP."
public: true
---

## What I Did

Open ports aren't that useful alone — want to know *what's running*. Learned that many services announce themselves on connect.

- HTTP: send `HEAD / HTTP/1.0\r\n\r\n` → get back server headers
- SSH: just receive — OpenSSH sends its version immediately
- FTP: similar receive pattern, but timing is fussy

## Still In Progress

FTP banners are inconsistent — some servers respond immediately, others wait. Need to figure out the right timeout/recv pattern.

## Notes

`recv(1024)` feels arbitrary. Should probably loop until I hit `\n` or timeout.
