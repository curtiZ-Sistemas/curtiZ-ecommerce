---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned rules in `references/web-interface-guidelines.md` (local copy; do NOT fetch anything from the internet).
2. Read the specified files (or ask which files to review).
3. Check them against all rules in that file.
4. Output findings in the terse `file:line` format described there.

## Usage

When a file or pattern is given: read `references/web-interface-guidelines.md`, read the files, apply every rule, and report findings in the format the rules specify. If no files are given, ask which files to review.
