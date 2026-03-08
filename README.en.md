# Histwrite

English · [简体中文](README.md)

**Histwrite is a historical writing workflow repository for OpenClaw and other AI agents.**

It packages the reusable parts of a historical writing workflow into one public repository:

- reusable templates, rubrics, memory files, and workflow content
- an executable `histwrite` runner CLI
- an optional browser relay for authenticated pages, snapshots, and tabs
- a thin OpenClaw plugin entry point

The goal is simple: help an agent work on a historical writing project as a project, not just generate isolated text. That includes project setup, materials indexing, export, and final checks.

## What It Can Do Today

The current public repository already provides:

- **Project setup**: create a Histwrite project with a standard directory layout
- **Library indexing**: scan a materials directory and build searchable output
- **Relay integration**: inspect relay status and capture browser state
- **Draft export**: merge project drafts into Markdown output
- **Final checking**: run `finalcheck` on generated files
- **Rewrite and evaluation tools**: expose `rewrite`, `judge`, and `doctor`
- **Content reuse**: let any agent directly consume the files under `content/`

## Repository Layout

- `content/`: templates, memory, rubrics, style guides, and public workflow content
- `runner/`: unified command layer for agents and CLI usage
- `relay/`: optional browser relay and browser extension
- `plugin-openclaw/`: OpenClaw plugin entry point
- `docs/`: integration notes, public migration history, and privacy rules
- `scripts/`: privacy scanning and pre-publish checks

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Inspect available commands

```bash
node runner/bin/histwrite.mjs help
```

### 3. Initialize a project

```bash
node runner/bin/histwrite.mjs project init --project ./paper
```

### 4. Check project status

```bash
node runner/bin/histwrite.mjs project status --project ./paper
```

### 5. Index a materials directory

```bash
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
```

### 6. Check relay status

```bash
node runner/bin/histwrite.mjs relay status --relay http://127.0.0.1:18792
```

### 7. Export a draft

```bash
node runner/bin/histwrite.mjs project export --project ./paper
```

## Current Runner Commands

The public runner currently exposes:

- `project init|status|export`
- `library index|status`
- `capture`
- `relay status`
- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `proxy`
- `episodes append`
- `doctor`

More Histwrite commands will continue to move into the runner over time.

## Using It With OpenClaw

If you use OpenClaw, this repository can act as a plugin entry point.

The plugin layer is intentionally thin. It only:

- receives natural-language or tool calls
- resolves default project directories and arguments
- forwards the request to the `histwrite` runner
- returns structured results

Relevant files:

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `docs/for-openclaw.md`

## Using It From Other Agents

If a host can read repository content, it can already reuse:

- `content/templates/`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

If the host also supports shell or tool execution, it can directly run:

```bash
node runner/bin/histwrite.mjs help
```

See:

- `docs/for-agents.md`

## What This Public Repository Does **Not** Include

To keep the public version safe to publish, this repository does **not** include:

- your private materials, downloaded articles, archives, or research directories
- personal email addresses, usernames, or private absolute paths
- institutional library proxy endpoints, browser sessions, cookies, tokens, or API keys
- the original private Git object history

This repository preserves the reusable capabilities, not a personal research archive.

## Privacy and Public History

If you want to see how this repository was split from a private workspace, start here:

- `docs/privacy.md`
- `docs/history/upstream-timeline.md`
- `docs/history/upstream-working-tree.md`

## Status

Histwrite is now a small public repository that can already be used in several ways:

- as a content repository
- as a runnable CLI tool
- as an OpenClaw plugin entry point
- as an optional relay companion

The next major step is to continue migrating more Histwrite commands into the runner and make the OpenClaw entry point more ergonomic.
