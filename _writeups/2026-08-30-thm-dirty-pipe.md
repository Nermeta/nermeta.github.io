---
title: "THM: Linux Privilege Escalation — Dirty Pipe (CVE-2022-0847)"
date: 2026-08-30
type: writeup
topic: cybersecurity
platform: TryHackMe
category: linux
difficulty: medium
tools: [gcc, python, nc, bash]
outcome: completed
tags: [CVE-2022-0847, dirty-pipe, linux, kernel-exploit, privilege-escalation]
audience: [tech]
summary: "Walkthrough of the Dirty Pipe TryHackMe room — understanding the pipe/splice race condition in Linux kernels < 5.16.11, building the PoC, and escalating from a low-privilege shell to root."
public: true
---

## Vulnerability Overview

CVE-2022-0847 (Dirty Pipe) is a Linux kernel privilege escalation vulnerability affecting kernels 5.8–5.16.10. It allows an unprivileged process to overwrite arbitrary read-only memory-mapped files — including SUID binaries and `/etc/passwd`.

The root cause: a newly initialized pipe buffer's `flags` field wasn't zeroed, allowing the `PIPE_BUF_FLAG_CAN_MERGE` flag to persist across splices into page cache, effectively writing into pages the process shouldn't be able to touch.

## Environment

- Kernel: `5.13.0-27-generic`  
- Verified vulnerable range: 5.8 ≤ kernel < 5.16.11

```bash
uname -r
# 5.13.0-27-generic ← confirmed vulnerable
```

## Exploitation

Used Max Kellermann's original PoC, adjusted to overwrite `/etc/passwd`:

```c
// writes new root entry with no password
overwrite_file("/etc/passwd", offset, payload);
```

Compiled on target:

```bash
gcc dirty_pipe.c -o dirty_pipe
./dirty_pipe /etc/passwd
su root   # no password prompt
```

Root shell in ~10 seconds.

Alternatively, overwriting an SUID binary (e.g. `/usr/bin/su`) with a shell payload also works and leaves less trace in `/etc/passwd`.

## Mitigation

- Patch kernel to ≥ 5.16.11, 5.15.25, or 5.10.102
- Backports exist for most major distros — check `apt changelog linux-image-$(uname -r)`
- No userspace mitigation exists; this is a kernel bug

## Key Takeaways

1. **Always `uname -r` early** — kernel version immediately tells you the local priv-esc landscape
2. **Dirty Pipe is surgical** — unlike Dirty COW, it's fast and reliable; patching lagging systems is urgent
3. **Page cache writes are the primitive** — understanding *why* the flag persisted made the exploit much clearer than just running a PoC blind

## References

- [Max Kellermann's write-up](https://dirtypipe.cm4all.com/)
- [CVE-2022-0847 NVD entry](https://nvd.nist.gov/vuln/detail/CVE-2022-0847)
