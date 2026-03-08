# Histwrite

English · [简体中文](README.md)

**Histwrite is a workflow for historical writing projects.**

Its core is not “a few commands,” and it is not a one-click paper generator. Histwrite is meant to organize the full path of a history paper — topic framing, research, material accumulation, drafting, polishing, and final checks — into a workflow that can keep moving forward.

This public repository is the **public foundation** of Histwrite. It currently exposes:

- `content/`: workflow templates, memory files, rubrics, and style constraints
- `runner/`: a subset of deterministic commands that have already been moved into the public runner
- `relay/`: an optional browser relay
- `plugin-openclaw/`: the OpenClaw plugin entry point

So the most important thing to understand is this:

- **the full Histwrite workflow** is broader than the command surface currently exposed in the public `runner`
- this README first explains what Histwrite as a workflow actually is, and only then explains what the current public repository already includes

---

## For History Students

### What the Histwrite Workflow Actually Is

Histwrite is not just a tool that “helps write a paragraph.” It is better understood as a workflow for historical writing.

At a high level, it tries to cover the stages that usually appear in an actual history paper process:

1. **Clarify the question**  
   Narrow down the topic, core question, argument, scope, periodization, and key concepts before drafting begins.

2. **Do deep research**  
   Not just one round of web search, but a connected research path that can include open browsing, authenticated browsing, and database-oriented lookup.

3. **Accumulate materials**  
   Turn excerpts, source notes, metadata, evidence points, and gaps into a working materials layer rather than letting them remain scattered notes.

4. **Build blueprint and outline**  
   Use accumulated material to stabilize the argument path and chapter structure.

5. **Write section by section**  
   Advance through the outline incrementally instead of treating the whole paper as one generation step.

6. **Polish and run final checks**  
   Drafting is followed by polishing, export, and final presentation-level checks such as `finalcheck`.

7. **Evaluate, tune, and label**  
   If Histwrite is being improved as a long-term system, it can also run evaluation, prompt tuning, and annotation loops.

In other words, Histwrite is closer to:

- systematizing the topic and materials first
- writing through structure instead of isolated text generation
- finishing with style, format, and quality control together

### How That Workflow Looks Inside Histwrite

In the original Histwrite design, the real workflow looks roughly like this.

**1. Start the workflow and clarify the project**

- `/histwrite on`
- `/histwrite <your topic / idea / question>`

This stage is about convergence:

- what the core question is
- where the thesis may go
- how scope and periodization are defined
- whether key concepts need clarification

**2. Run deep research instead of a single web search**

- `/histwrite research <topic/keywords>`

This is meant to open a research path rather than just collect search results. In the original design, it can involve both open search and authenticated / database-facing search.

**3. Find materials and turn them into working material**

Typical actions include:

- `/histwrite sources plan`
- `/histwrite sources open 3`
- `/histwrite material <excerpt>`
- `/histwrite interpret ...`
- `/histwrite library ...`
- `/histwrite zotero ...`
- `/histwrite ingest ...`

The point is not just to save links. The point is to make materials usable later in writing.

**4. Organize material through blueprint and outline**

- `/histwrite outline generate`
- `/histwrite outline map`
- `/histwrite project sync`

This stage answers questions such as:

- what the argument path is
- which material belongs to which section
- where the gaps are
- how draft files should line up with the outline

**5. Write section by section**

- `/histwrite write next`
- `/histwrite write section <id>`
- `/histwrite draft <instruction>`

The workflow is incremental: write the next section, compare it to the overall structure, then decide whether to keep writing, collect more material, or revise the outline.

**6. Polish, export, and run final checks**

- `/histwrite polish`
- `/histwrite export`
- `/histwrite finalcheck <path>`

This stage is not just cosmetic polishing. It is where style, coherence, de-AI revision, and presentation-level format checks come together.

**7. If you treat Histwrite as a long-term system, continue with evaluation and tuning**

- `/histwrite dataset export`
- `/histwrite eval run`
- `/histwrite tune run`
- `/histwrite label push|pull`
- `/histwrite services up argilla`

This is why Histwrite is more than a one-off assistant. It is meant to keep improving as a workflow.

### How This Maps to a Real History Writing Method

What makes Histwrite distinctive is not just the number of commands. It is that the workflow already aligns with a very recognizable history-writing practice:

- start from a question or topic seed
- work through historiography and secondary literature first
- then move into primary materials and source work
- then connect material to the outline
- then write section by section
- then revise repeatedly and unify style and format

So Histwrite is much closer to:

- **historiography first**
- **then sources**
- **then outline-driven section writing**
- **then repeated revision**

That is why an earlier README direction was wrong: it described “what is in the repository now” before explaining what the workflow actually is.

### What the Current Public Repository Already Exposes

This is the part that needs to be stated honestly.

The **full Histwrite workflow** and the **currently exposed public runner surface** are not the same thing.

What this public repository clearly exposes today is:

- `content/`: templates, memory, rubrics, style, and handoff content
- `runner/`: a subset of deterministic commands already moved into the public runner
- `relay/`: browser relay
- `plugin-openclaw/`: the OpenClaw plugin entry point

The currently exposed runner commands mainly include:

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

So the right interpretation is:

- the **workflow design** is already broader and clearer than that
- the public **runner command surface** is still catching up to the full workflow

For a history student, the public repository is currently most useful as:

- a project skeleton for historical writing
- a toolbox for materials, indexing, export, and checking
- a rule layer for agent-assisted writing through `content/`

---

## For LLMs / Agents

### Understand the Full Workflow First

If you are integrating Histwrite into an agent, the most common mistake is to start from the public `runner` and assume Histwrite is “just a plugin with some commands.”

The better order is:

1. **understand the full Histwrite workflow**
2. **then understand which layers of that workflow are already public in this repository**

The full workflow includes at least these stages:

- clarify the question
- deep research
- material accumulation
- interpret / library / zotero / ingest
- blueprint and outline
- section-by-section writing
- polish / export / finalcheck
- eval / tune / label

What this repository currently exposes is mainly four layers:

- `content/`
- `runner/`
- `relay/`
- `plugin-openclaw/`

So for an agent, Histwrite should first be understood as:

- a **content-first workflow repository**
- a project skeleton with a fixed layout contract
- a partially exposed deterministic tool layer
- an optional browser integration layer

### What You Should Read First

If the host cannot execute commands at all, Histwrite still has immediate value as a content source.

Read these first:

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

### How You Should Call It

If the host supports shell or tool execution, prefer the public `runner` instead of inventing your own Histwrite-specific filesystem behavior.

Unified entry point:

```bash
node runner/bin/histwrite.mjs help
```

The currently public runner can be grouped like this.

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

**4. Output handling and checks**

- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `doctor`
- `episodes append`

A sensible order is usually:

1. `project init`
2. `project status`
3. `library index`
4. connect `relay` only when authenticated browsing matters
5. `project export` / `export`
6. `finalcheck`

### How You Should Understand the Project Layout

Do not invent directory names. The current Histwrite layout contract includes at least:

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

That means:

- materials live under `材料/`
- draft text lives under `正文/`
- exported output lives under `导出/`
- run traces live under `.histwrite/logs`
- long-term memory and derived rules should go under `.histwrite/learn`

### How To Understand the OpenClaw Layer

`plugin-openclaw/` should currently be treated as a **thin adapter**, not the main business layer.

Its job is to:

- receive calls
- resolve default project directories
- translate command strings into runner argv
- execute the local runner
- return text output and structured details

Relevant files:

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `plugin-openclaw/src/runtime.ts`

If another host is added later, prefer reusing:

- `content/`
- `runner/`
- `relay/`

rather than copying OpenClaw-specific adapter logic.

### How To Understand the Relay

`relay/` is an **optional enhancement layer**.

Use it only when the workflow actually needs:

- authenticated browser pages
- tab inspection
- page snapshots
- browser-derived context

If the host does not need authenticated browsing, `content/ + runner/` is enough.

### Boundaries You Must Respect

If you are integrating this repository into an agent, assume these boundaries by default:

- do not treat it as a private research archive
- do not expect real credentials, cookies, tokens, or API keys in the repository
- do not assume the original private Git object history is available
- do not describe unpublished or not-yet-public commands as if they were already part of the stable public runner
- do not confuse writing rules in `content/` with historical sources or citations

What this repository publishes is:

- workflow assets
- a content layer
- a tool layer
- a partial host-integration layer

It is not a public dump of private research data.

### Shortest Practical Summary for Agents

The safest integration order is:

1. understand the full workflow first
2. read `content/`
3. call `runner`
4. add `relay` only when authenticated browsing matters
5. use `plugin-openclaw/` only when the host is OpenClaw

That order avoids two common mistakes:

- reducing Histwrite to “just a few commands”
- pretending that every part of the original private workflow has already been fully exposed in the public runner
