---
title: "NahamCon CTF — Web Challenges"
date: 2026-07-14
type: writeup
topic: cybersecurity
platform: CTF
category: web
difficulty: medium
tools: [burpsuite, ffuf, python, curl]
outcome: completed
tags: [IDOR, SSRF, JWT, web, ctf, nahamcon]
audience: [tech]
summary: "Writeup of three web challenges from NahamCon 2026 CTF — an IDOR in a user profile endpoint, an SSRF via PDF renderer, and a JWT algorithm confusion attack."
public: true
---

## Overview

NahamCon 2026 had a solid web track. Knocked out three before the time ran out. Notes on the more interesting ones.

---

## Challenge 1: ProfilePic (IDOR)

The app let users upload a profile photo. The endpoint was:

```
POST /api/users/1042/photo
```

Swapping the user ID in the URL with any other valid ID and sending a request with a valid session returned the target user's photo URL. No ownership check server-side.

From there, iterating IDs with a short Python script leaked profile images for all users. The flag was embedded in the admin account's profile image as text.

---

## Challenge 2: PDFify (SSRF)

App accepted a URL and rendered it as a PDF via a headless browser server-side.

```
POST /render
{"url": "https://example.com"}
```

Tried internal addresses:

```
{"url": "http://169.254.169.254/latest/meta-data/"}
```

AWS metadata endpoint responded. Followed the path to `/iam/security-credentials/` → leaked temporary AWS keys. The flag was in an S3 bucket accessible with those credentials.

**Mitigation note:** Validate/allowlist URLs server-side and block RFC-1918 + link-local ranges before hitting any renderer.

---

## Challenge 3: JWTed (Algorithm Confusion)

App used JWT for auth. Downloaded the public key from `/jwks.json`. The server accepted both RS256 and HS256 — classic algorithm confusion.

Forged a token signed with the public key as the HMAC secret, set `alg: HS256`, bumped `role` to `admin`.

```python
import jwt
token = jwt.encode({"sub": "user", "role": "admin"}, pub_key, algorithm="HS256")
```

Admin panel → flag.

## Key Takeaways

1. **Always test IDOR on every ID in every endpoint** — auth on write ≠ auth on read
2. **SSRF to metadata is still alive** — IMDSv2 mitigates it on AWS but plenty of infra hasn't migrated
3. **JWT `alg: none` and confusion are separate bugs** — check both when you see JWTs in scope
