---
title: "How Active Directory Actually Works"
date: 2026-02-20
type: deep-dive
topic: cybersecurity
tags: [active-directory, windows, identity, sysadmin, ldap, kerberos]
difficulty: intermediate
tech_stack: [windows-server, powershell, ldap, kerberos]
estimated_read: 18
audience: [tech]
summary: "A thorough breakdown of Active Directory's core concepts — forests, domains, trusts, authentication flow, and where it commonly gets exploited."
public: true
---

## Why This Deserves a Deep Dive

Active Directory is in nearly every enterprise Windows environment, and it's the most common attack surface in real-world engagements. Yet most resources explain what it is without explaining how it works — which is exactly the gap attackers exploit.

## The Foundation

AD is a directory service: a centralized database of every object in your network — users, computers, groups, printers, policies.

**Key concepts to internalize first:**
- **Forest** — the top-level security boundary. Separate forests, separate security domains.
- **Domain** — an administrative boundary within a forest. Most orgs run one domain.
- **OU (Organizational Unit)** — a container for organizing objects. Group Policy applies here.
- **Domain Controller (DC)** — the server that runs AD. Every auth request goes through it.

## How Authentication Actually Works

AD uses Kerberos as its authentication protocol (not NTLM, though that still exists as a fallback).

The Kerberos flow:
1. User enters credentials → sent to DC's **Authentication Service (AS)**
2. DC verifies password hash, issues a **Ticket Granting Ticket (TGT)** — encrypted with the `krbtgt` account's hash
3. User presents TGT to the **Ticket Granting Service (TGS)** when accessing a resource
4. TGS issues a **Service Ticket** for the specific resource
5. User presents Service Ticket to the target server — server validates without calling DC again

This is why stealing a TGT (Pass-the-Ticket) or forging one (Golden Ticket) is so powerful.

## Where It Gets Complicated

**SPNs (Service Principal Names)** link service accounts to services. Kerberoasting abuses this — any domain user can request a Service Ticket for any SPN, then crack the service account's password offline.

**Delegation** allows services to impersonate users. Unconstrained delegation = a server can impersonate any user to any service. This is almost always over-provisioned.

## Where It Gets Exploited

- **Kerberoasting** — request service tickets, crack offline
- **AS-REP Roasting** — target accounts with pre-auth disabled
- **Golden/Silver Tickets** — forge TGTs/Service Tickets using stolen hashes
- **AD CS (Certificate Services)** — misconfigurations in certificate templates allow privilege escalation (ESC1–ESC13)
- **DCSync** — if you have replication rights, you can pull all password hashes from a DC

## Further Reading

- [SpecterOps blog on AD CS](https://posts.specterops.io/certified-pre-owned-d95910965cd2)
- *The Hacker Playbook 3* — AD attack chapters
- HackTricks AD section — practical reference
