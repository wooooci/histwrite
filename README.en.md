# Histwrite

English · [简体中文](README.md)

Histwrite is a **content-first** historical writing workflow repository. It is designed primarily for **OpenClaw**, while also making the underlying content and command surface reusable by other AI agents that can read a repository, call shell commands, or invoke tools.

It is not just a prompt pack, and it is not a heavy plugin tied to a single host. Instead, it keeps the content layer, command layer, and optional browser capabilities in one public-ready repository.

## What It Includes

Histwrite is organized into four main parts:

- `content/`: public templates, memory files, rubrics, style guides, and workflow material
- `runner/`: a unified command layer with deterministic actions that agents can call
- `relay/`: an optional browser relay for authenticated pages, snapshots, and tab inspection
- `plugin-openclaw/`: a thin OpenClaw plugin entry point

This supports two main usage modes:

1. **Read the content**: directly consume templates, rubrics, memory, and workflow notes in `content/`
2. **Run commands**: use the `histwrite` runner for project setup, library indexing, snapshots, export, and checking

## Why It Is Structured This Way

This repository intentionally keeps a **content-first, tools-second** shape:

- For many agents, the content alone is already useful
- For agents with execution support, the `histwrite` runner adds a stable command surface
- For workflows that need authenticated browsing, `relay/` can be enabled on demand
- For OpenClaw users, the plugin is the default entry point

In short, **OpenClaw is the primary entry point, not the only one**.

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Inspect runner commands

```bash
node runner/bin/histwrite.mjs help
```

### 3. Initialize a Histwrite project

```bash
node runner/bin/histwrite.mjs project init --project ./demo-project
```

### 4. Check project status

```bash
node runner/bin/histwrite.mjs project status --project ./demo-project
```

### 5. Index a materials directory

```bash
node runner/bin/histwrite.mjs library index --project ./demo-project --materials ./demo-project/材料
```

### 6. Check relay status

```bash
node runner/bin/histwrite.mjs relay status --relay http://127.0.0.1:18792
```

## Using Histwrite From Different Hosts

### OpenClaw

OpenClaw can use this repository through the thin plugin layer. The plugin is responsible for:

- receiving natural-language or tool-based requests
- resolving default project directories and runner arguments
- delegating to the `histwrite` runner
- returning structured results

Relevant files:

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `docs/for-openclaw.md`

### Other Agents

Any host that can read repository content can at least reuse:

- `content/templates/`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

If the host also supports shell or tool execution, it can call commands from `runner/` directly.

See also:

- `docs/for-agents.md`

## Repository Layout

- `content/`: public content layer
- `runner/`: unified CLI / tool command layer
- `relay/`: enhanced browser capabilities
- `plugin-openclaw/`: OpenClaw plugin entry point
- `docs/`: integration notes, migration history, privacy rules, planning docs
- `scripts/`: privacy scanning and pre-publish checks

## Privacy Boundary

This repository treats **private information removal** as a hard requirement:

- no personal email addresses, usernames, or private absolute paths
- no institutional library proxy endpoints, browser sessions, cookies, tokens, or API keys
- no privately collected materials, full-text articles, downloaded archives, or personal research directories
- no direct publication of the original private Git object history; the public repository uses a rebuilt safe commit chain instead

See:

- `docs/privacy.md`
- `docs/history/upstream-timeline.md`
- `docs/history/upstream-working-tree.md`

## Current Status

The public repository already includes:

- public content templates and rubrics
- an executable `histwrite` runner
- an optional browser relay
- a thin OpenClaw plugin entry point
- baseline privacy scanning and test coverage

Next steps are to continue moving more Histwrite commands into the runner and make the OpenClaw plugin a more ergonomic natural-language entry point.
