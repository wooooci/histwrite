# Histwrite

English · [简体中文](README.md)

**Histwrite is a project-oriented historical writing repository with a content layer, a runner, and an OpenClaw entry point.**

It is not a black-box “write my paper for me” system. Instead, it exposes the reusable layers of a historical writing workflow as a public repository:

- `content/`: writing templates, memory files, rubrics, and workflow material
- `runner/`: executable commands for project setup, indexing, export, and checking
- `relay/`: an optional browser relay for authenticated pages, snapshots, and tabs
- `plugin-openclaw/`: a thin OpenClaw plugin entry point

If you are a history student, the first major section below explains what this repository can do for your writing process.  
If you are an LLM or agent developer, the second section explains how to read the repository, call commands, and respect its boundaries.

---

## For History Students

### What Histwrite Is For You

If your writing process usually looks something like this:

- define a topic, question, scope, and period
- build up a folder of PDFs, notes, excerpts, and OCR output
- slowly connect materials to an outline
- draft, revise, export, and only then run final checks

then Histwrite is meant to serve as a **project workspace for that process**, not a replacement for your judgment.

It is better understood as:

- a standard directory structure for a writing project
- a reusable set of writing rules and memory files for agents
- a tool layer for indexing materials, exporting drafts, and checking final output

At its current public stage, Histwrite is especially useful for:

- setting up a paper project
- organizing `materials / blueprint / outline / draft / export` directories
- indexing a materials folder for later retrieval
- using a browser relay when authenticated pages matter
- exporting the current draft
- running a final check before handoff or submission

### What You Will Actually Use

If you use Histwrite as a practical writing tool, you will mostly deal with three kinds of things.

**1. Project directories**

After `project init`, Histwrite creates a standard project layout that includes:

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/`

In practice:

- `材料/` is where your source files, OCR results, and indexes live
- `蓝图/` is where you keep core questions, structure notes, or evidence plans
- `大纲/` is where your outline lives
- `正文/` is where active draft files live
- `导出/` is where exported combined output goes

**2. Writing rules and reusable content**

The `content/` directory holds the public reusable content layer. Important files include:

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

These files act as the baseline instructions for how an agent should write, revise, and judge output quality.

**3. Commands**

The current public version already exposes these stable commands:

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

Think of them as project-management and writing-support tools, not as a one-click paper generator.

### A Realistic Way To Use It

A realistic public-repo workflow for a history student looks like this:

**Step 1: initialize a project**

```bash
node runner/bin/histwrite.mjs project init --project ./paper
```

**Step 2: place materials into `材料/`**

Put PDFs, notes, OCR output, and working source files there.

**Step 3: index the materials**

```bash
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
```

**Step 4: keep working directories in order**

- put structural notes in `蓝图/` and `大纲/`
- put draft text in `正文/`
- enable `relay/` only when browser-authenticated workflows are needed

**Step 5: export and check**

```bash
node runner/bin/histwrite.mjs project export --project ./paper
```

Then run `finalcheck` on the resulting output.

### What You Should Not Expect

To set expectations clearly:

- this is **not** yet a fully public one-click autonomous paper-writing system
- this is **not** a backup repository for your private research archive
- this public repository does **not** include full-text articles, downloaded archives, or personal research notes
- this does **not** replace historical interpretation, source criticism, or your own scholarly decisions

The public version is best understood as:

- a project skeleton for historical writing with agents
- a writing workflow toolbox
- a public foundation that can grow into a fuller workflow over time

---

## For LLMs / Agents

### What This Repository Actually Is

If you are integrating Histwrite into an agent, do not think of it primarily as “a plugin.” Think of it first as:

- a **content-first** repository
- a workflow skeleton with a fixed project layout
- a growing deterministic command surface
- an optional browser capability component

The most stable public parts right now are:

- the content assets in `content/`
- the deterministic commands in `runner/`
- the project layout contract
- the optional relay integration

### What You Should Read First

If you want to use Histwrite as a rule source or content pack, read these first:

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

These provide:

- style constraints
- quality criteria
- context handoff conventions
- default long-term memory scaffolding
- default evaluation rubrics

Even if the host has no command execution at all, reading these files is already useful.

### How You Should Call It

If the host supports shell or tool execution, prefer the `runner` instead of reimplementing Histwrite-specific filesystem behavior.

Unified entry point:

```bash
node runner/bin/histwrite.mjs help
```

The current command surface can be grouped into four categories.

**1. Project structure**

- `project init`
- `project status`
- `project export`

**2. Materials and indexing**

- `library index`
- `library status`

**3. Browser / relay**

- `relay status`
- `capture`
- `proxy`

**4. Output handling and checking**

- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `doctor`
- `episodes append`

A sensible integration order is usually:

1. `project init`
2. `project status`
3. `library index`
4. add `relay` only if needed
5. `project export` / `export`
6. `finalcheck`

### What Project Layout You Should Assume

Do not invent your own directory names if you want to work with Histwrite. Prefer the default layout contract used by the runner:

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

In practice, that means:

- read materials from `材料/`
- read drafts from `正文/`
- expect exports in `导出/`
- expect run traces in `.histwrite/logs`
- put long-term memory or derived rules in `.histwrite/learn`

### How To Understand the OpenClaw Layer

`plugin-openclaw/` should be treated as a **thin adapter**, not the main business layer.

Its job is to:

- receive calls
- resolve default project directories
- turn a command string into runner argv
- execute the local runner
- return text output plus structured details

Relevant files:

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `plugin-openclaw/src/runtime.ts`

If you want to support another host later, prefer reusing `content/ + runner/ + relay/` rather than copying OpenClaw-specific logic.

### How To Understand the Relay

`relay/` is an **optional enhancement component**.

Only enable it when you really need:

- authenticated browser pages
- tab inspection
- page snapshots
- browser-derived context capture

If your host does not need browser-authenticated workflows, `content/ + runner/` is enough.

### Boundaries You Must Respect

If you are an agent integrating this repository, assume the following boundaries by default:

- do not treat it as a private research archive
- do not expect real credentials, cookies, tokens, or API keys in the repository
- do not assume the original private Git object history is available
- do not describe unpublished automation as if it were already public and stable
- do not confuse writing rules in `content/` with research sources or citations

What this repository publishes is the **workflow asset layer and tool layer**, not private research data.

### The Shortest Useful Summary For Agents

If you want the fastest stable integration path, use this order:

1. read `content/`
2. call `runner`
3. add `relay` only when authenticated browsing matters
4. use `plugin-openclaw/` only when the host is OpenClaw

That is the most accurate way to understand Histwrite in its current public form.
