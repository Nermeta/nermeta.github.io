---
title: "THM: Attacking Kerberos"
date: 2026-05-18
type: writeup
topic: cybersecurity
platform: TryHackMe
category: active-directory
difficulty: easy
tools: [kerbrute, impacket, rubeus, bloodhound]
outcome: completed
tags: [kerberos, AS-REP-roasting, kerberoasting, pass-the-ticket, windows]
audience: [tech]
summary: "Walkthrough of TryHackMe's Attacking Kerberos room — covering enumeration, AS-REP roasting, Kerberoasting, Pass the Ticket, and Golden/Silver ticket attacks from first principles."
public: true
---

## Room Overview

TryHackMe's Attacking Kerberos room walks through the major Kerberos attack categories in a guided lab environment. Good foundational room before tackling AD machines on HTB.

## Task Breakdown

### Enumeration with Kerbrute

```bash
kerbrute userenum --dc CONTROLLER.local -d CONTROLLER.local User.txt
```

Found valid usernames without authentication — Kerberos pre-auth error vs "principal unknown" is the tell.

### AS-REP Roasting

Users without pre-authentication required hand over an encrypted TGT portion you can crack offline.

```bash
impacket-GetNPUsers CONTROLLER.local/ -usersfile found_users.txt -no-pass -dc-ip 10.10.x.x
```

Cracked with hashcat mode 18200 → plaintext password in under a minute on wordlist.

### Kerberoasting

Any user can request service tickets for SPNs. The ticket is encrypted with the service account's hash.

```bash
impacket-GetUserSPNs CONTROLLER.local/user:password -dc-ip 10.10.x.x -request
```

Mode 13100 in hashcat. Weak service account passwords crack fast.

### Pass the Ticket

Dumped tickets with Mimikatz, injected with Rubeus:

```bash
Rubeus.exe ptt /ticket:<base64>
```

### Golden / Silver Tickets

Golden ticket requires KRBTGT hash — full domain persistence. Silver ticket scoped to one service. Both bypass normal auth flows entirely.

## Key Takeaways

1. **Enumerate first** — Kerbrute with no creds reveals valid usernames via Kerberos error codes
2. **Pre-auth is your friend** — any account without it is AS-REP roastable; audit these regularly
3. **SPNs are attack surface** — service accounts with SPNs need strong, rotated passwords
4. **KRBTGT hash = game over** — protect it, rotate it after any compromise

## Tools Used

| Tool | Use |
|---|---|
| Kerbrute | Username enumeration via Kerberos |
| impacket-GetNPUsers | AS-REP roasting |
| impacket-GetUserSPNs | Kerberoasting |
| Rubeus | Ticket manipulation and injection |
| Hashcat | Offline hash cracking |
