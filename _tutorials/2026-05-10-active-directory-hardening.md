---
title: "Hardening Active Directory: Tiered Admin Model"
date: 2026-05-10
type: tutorial
topic: sysadmin
tags: [active-directory, security, hardening, windows-server, powershell]
difficulty: journeyman
tech_stack: [active-directory, windows-server, powershell, group-policy]
estimated_read: 18
audience: [tech]
summary: "Implement a three-tier privileged access model in AD that isolates domain admin credentials from workstation and server tiers — significantly reduces lateral movement risk."
public: true
---

## What You'll Build

A tiered OU structure with GPO-enforced credential isolation, Privileged Access Workstations policy, and an audit script that flags tier violations.
