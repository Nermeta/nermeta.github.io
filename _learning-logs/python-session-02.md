---
title: "Python S02: Sockets Basics"
date: 2026-09-03
type: learning-log
parent: python-for-security
domain: scripting
status: completed
requires: [python-session-01]
tags: [python, scripting, sockets, networking]
audience: [tech]
summary: "Dug into the socket library. Wrote a basic TCP connect scanner that actually works on my home network."
public: true
---

## What I Did

Picked up where session 1 left off and got into `socket`. Followed along with a walkthrough, then rewrote it from scratch without looking.

```python
import socket

def tcp_connect(host, port, timeout=1):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    result = s.connect_ex((host, port))
    s.close()
    return result == 0
```

## What Clicked

`connect_ex` returning 0 vs non-zero instead of raising an exception — much cleaner for scanning.

## Next Time

Want to add threading so it doesn't scan ports one at a time.
