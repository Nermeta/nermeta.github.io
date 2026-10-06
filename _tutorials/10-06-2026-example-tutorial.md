---
title: "Automating Active Directory Reports with PowerShell"
date: 2026-03-01
type: tutorial
topic: sysadmin
tags: [powershell, active-directory, automation, scripting]
difficulty: intermediate
tech_stack: [powershell, windows-server, active-directory]
estimated_read: 12
audience: [tech]
summary: "A step-by-step guide to writing a PowerShell script that pulls Active Directory user data and exports a formatted CSV report — no third-party tools required."
public: true
---

## What You'll Build

A PowerShell script that queries AD for all enabled user accounts, pulls key attributes (name, department, last logon, password expiry), and exports a clean CSV report.

## Prerequisites

- Windows Server with RSAT tools installed (or run directly on a DC)
- Domain user account with read access to AD (standard user is enough for most queries)
- PowerShell 5.1+

## Step 1 — Import the Module

```powershell
Import-Module ActiveDirectory
```

Test it works: `Get-ADUser -Filter * -ResultSetSize 1` should return one user object.

## Step 2 — Query Users with Attributes

```powershell
$users = Get-ADUser -Filter {Enabled -eq $true} -Properties `
    DisplayName, Department, LastLogonDate, PasswordLastSet, PasswordNeverExpires, `
    EmailAddress, Title
```

`-Properties` is required — AD only returns a minimal set by default. List every field you need explicitly.

## Step 3 — Shape the Data

```powershell
$report = $users | Select-Object `
    @{N='Name';          E={$_.DisplayName}},
    @{N='Username';      E={$_.SamAccountName}},
    @{N='Department';    E={$_.Department}},
    @{N='Title';         E={$_.Title}},
    @{N='Email';         E={$_.EmailAddress}},
    @{N='Last Logon';    E={$_.LastLogonDate}},
    @{N='Pwd Last Set';  E={$_.PasswordLastSet}},
    @{N='Pwd Never Exp'; E={$_.PasswordNeverExpires}}
```

## Step 4 — Export to CSV

```powershell
$reportPath = "C:\Reports\AD-Users-$(Get-Date -Format 'yyyy-MM-dd').csv"
$report | Export-Csv -Path $reportPath -NoTypeInformation
Write-Host "Report saved to $reportPath"
```

## The Full Script

```powershell
#Requires -Module ActiveDirectory

$reportPath = "C:\Reports\AD-Users-$(Get-Date -Format 'yyyy-MM-dd').csv"

$users = Get-ADUser -Filter {Enabled -eq $true} -Properties `
    DisplayName, Department, LastLogonDate, PasswordLastSet, `
    PasswordNeverExpires, EmailAddress, Title

$report = $users | Select-Object `
    @{N='Name';          E={$_.DisplayName}},
    @{N='Username';      E={$_.SamAccountName}},
    @{N='Department';    E={$_.Department}},
    @{N='Title';         E={$_.Title}},
    @{N='Email';         E={$_.EmailAddress}},
    @{N='Last Logon';    E={$_.LastLogonDate}},
    @{N='Pwd Last Set';  E={$_.PasswordLastSet}},
    @{N='Pwd Never Exp'; E={$_.PasswordNeverExpires}}

$report | Export-Csv -Path $reportPath -NoTypeInformation
Write-Host "Done — $($report.Count) users exported to $reportPath"
```

## Common Issues

**"Access Denied"** — You need RSAT installed and to run from a domain-joined machine. Check `Get-Module ActiveDirectory` first.

**LastLogonDate is null** — This attribute replicates across DCs every 9–14 days, not in real time. For accurate data, query all DCs and take the max.

**Large environments** — Add `-SearchBase "OU=Users,DC=corp,DC=local"` to scope to a specific OU instead of querying the whole directory.
