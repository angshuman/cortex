# Cortex Agent Loop — How It Works

## Overview

Every user message goes through a two-phase pipeline before the loop starts:

```
User message
    │
    ▼
① Intent extraction  (1 fast LLM call, UI only)
    │
    ▼
② System prompt assembled
    │
    ▼
③ Think → Act → Observe loop  (repeats until done)
    │
    ▼
Final assistant message
```

---

## Phase 1 — Intent Extraction

**File:** `server/agent.ts → extractIntent()`  
**Cost:** 1 LLM call, max 150 output tokens  
**Purpose:** Purely for the UI "Understanding…" badge. Does not affect execution.

### System prompt sent
```
You are an intent extractor. Given a user message, write one concise sentence
describing what they want to achieve. Be specific and action-oriented. Start
with a verb.
Output ONLY valid JSON: { "intent": "..." }
```

### User prompt sent
```
<the raw user message>
```
(Or `"(user sent an image with no text — analyze and save as note)"` for image-only messages.)

### Output
Emitted as a `thought` event with `metadata.kind = "intent"`.  
Shown in the UI as the "Understanding" line and in the Loop Inspector.

---

## Phase 2 — System Prompt Assembly

**File:** `server/agent.ts → buildSystemPrompt()`

The system prompt is assembled fresh for each request from these sections:

| Section | Content |
|---|---|
| **Identity** | "You are Cortex, a personal AI operating system assistant…" |
| **Capabilities** | Bullet list: notes, tasks, web, MCP, vision |
| **MCP Servers** | Dynamic: lists connected servers + available tool names. If Playwright is connected, explicitly says **PREFER browser over web_fetch** |
| **Image Handling** | Rules for describing/saving images |
| **Current Context** | Live snapshot: up to 15 tasks (with status/priority) + up to 15 note titles |
| **Execution Approach** | The agentic behavior rules (see below) |
| **Skill Instructions** | Injected only for skills whose `triggerKeywords` match the message (or `priority=0` always-on skills) |
| **Active Context** | If the user has pinned notes/tasks open, their full content is appended here |
| **Custom Instructions** | `agentSettings.systemPromptSuffix` if set |

### Execution Approach (verbatim)
```
## Execution Approach — Gather → Critique → Act → Observe → Revise

Every task follows this deliberate sequence:

1. Gather first. Before writing a single word or making any change, collect context.
   Read relevant notes, search for information, fetch what exists — in parallel where
   possible. Never build before you understand what's there.

2. Critique before building. After gathering, reason about what you found. Say what
   the situation is, what's missing, what problems you see, and what approach you'll
   take. Write this out before moving to action. This is the think step.

3. Act with intention. Execute: write, create, update, search, or call. Do the real
   work based on your critique, not on assumptions.

4. Observe your output. After creating or modifying something important, verify it.
   Read back what you wrote. Check for correctness, completeness, and quality before
   declaring done.

5. Revise surgically. If something needs fixing, make targeted edits — not rewrites.
   Each correction is small and specific. Incremental improvement, not starting over.

Practical rules:
- Parallel reads: gather multiple pieces of context in one round of tool calls
- Think out loud: after gathering, write your analysis before the next tool call
- Verify: after creating something substantial, read it back with a tool call
- Browser first for web: browser_navigate → browser_snapshot over web_fetch
- Notes as workspace: for large outputs, build into a note rather than one shot
```

### Why the previous "act first" rule was removed

The old rule said "your first output must be a tool call." This caused the model to jump
into building without understanding what already existed — creating duplicates, missing
context, writing generic content instead of targeted content.

The new pattern lets the model gather → critique → act, which means:
- It reads what's already there before writing more
- It surfaces problems *before* making changes (not after)
- The critique text is emitted as a `thought` event (text alongside tool calls) so the
  loop continues — text-only output still ends the loop as before

---

## Phase 3 — The Agentic Loop

**File:** `server/agent-loop.ts`  
**Max turns:** `agentSettings.maxTurns` (default 20)  
**Timeout:** 2 minutes per LLM call

The loop is identical in structure for all providers. Claude uses the native Messages API with optional extended thinking; OpenAI/Grok/Google use the Chat Completions API.

```
┌─────────────────────────────────────────────┐
│              THINK (LLM call)               │
│                                             │
│  Input sent each turn:                      │
│  • system prompt (full, every turn)         │
│  • full conversation history                │
│    - user message + images                  │
│    - [Tool: name] args  (prior acts)        │
│    - [Tool Result: name] result (prior obs) │
│    - thinking blocks (Claude, echoed back)  │
│  • tool definitions (all enabled skills     │
│    + all connected MCP tools)               │
└────────────────┬────────────────────────────┘
                 │
         Model responds with one of:
                 │
    ┌────────────┴────────────┐
    │ thinking block (Claude) │  → emit "thought" event (truncated to 500 chars)
    │ text + tool calls       │  → text emitted as "thought"; tool calls queued
    │ text only               │  → DONE → emit final "message", break loop
    └────────────┬────────────┘
                 │ (tool calls present)
                 ▼
┌─────────────────────────────────────────────┐
│               ACT (tool execution)          │
│                                             │
│  For each tool call:                        │
│  • emit "tool_call" event                   │
│  • execute the tool locally (built-in)      │
│    OR forward to MCP server                 │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│              OBSERVE (feed result back)     │
│                                             │
│  Tool result appended to conversation as:  │
│  • Claude: { role: "user",                 │
│      content: [{ type: "tool_result", … }] │
│  • OpenAI: { role: "tool",                 │
│      tool_call_id: …, content: result }    │
│  • emit "tool_result" event                │
│  • continue → back to THINK                │
└─────────────────────────────────────────────┘
```

The model "observes" by reading its own message history on the next LLM call. There is no separate observation prompt — the tool result IS the observation, appended in the format the model natively understands.

---

## What Is Sent on Each Turn (Concrete Example)

For a 2-turn research task with web_search → browser_navigate:

**Turn 1 — THINK input**
```
[system]  <full system prompt>
[user]    Research US-Iran relations and argue for/against war.
```
**Turn 1 — ACT**  Model returns `tool_use: web_search { query: "US Iran relations 2024" }`

**Turn 1 — OBSERVE**  Result appended:
```
[assistant]  <thinking block if Claude>
             <tool_use: web_search {...}>
[user]       <tool_result: "Title: ... URL: ... Snippet: ...">
```

**Turn 2 — THINK input** (full history replayed)
```
[system]  <full system prompt>
[user]    Research US-Iran relations…
[asst]    <tool_use: web_search>
[user]    <tool_result: search results>
```
Model now calls `tool_use: browser_navigate { url: "…" }`

…and so on until the model produces text with no tool calls → final message.

---

## Claude-specific: Extended Thinking

For models `claude-opus-4*`, `claude-sonnet-4*`, `claude-3-7*`:

- `thinking: { type: "enabled", budget_tokens: 8000 }` is added to every call
- `max_tokens` is raised to `max(agentSettings.maxTokens, 8000 + 8192)` to accommodate thinking + output
- Temperature must NOT be set (Anthropic constraint)
- Thinking blocks are echoed verbatim in subsequent turns (Anthropic requirement)
- Thinking content is streamed to the UI truncated to 500 chars as `thought` events

---

## Event Types Emitted to UI

| Event | When | UI effect |
|---|---|---|
| `thought` (kind=intent) | After intent extraction | "Understanding…" badge + Loop Inspector intent |
| `thought` | Claude thinking block | Loop Inspector THINK row |
| `thought` | Text alongside tool calls | Loop Inspector THINK row |
| `thought` | "Thinking…" / "Working… (step N)" | Header status text (OpenAI only) |
| `tool_call` | Before each tool runs | Loop Inspector ACT row; header "Using tool_name" |
| `tool_result` | After each tool runs | Loop Inspector OBS row |
| `message` (role=assistant) | Final answer | Chat bubble |
| `error` | Any exception | Error display |
| `status: thinking` | Before loop starts | UI → thinking mode |
| `status: done` | After loop ends (always, via finally) | UI → idle mode |

---

## Context Compaction

When input tokens exceed 75% of the context window (200k for Claude, 128k for OpenAI), `compactContext()` summarizes the oldest half of the conversation via one LLM call and replaces it with a single summary message. After compaction, Claude's `claudeMessages` array is rebuilt from the simplified `messages` history (losing old thinking blocks, which is acceptable).

---

## Skill Selection

Skills are injected into the system prompt selectively:
- `priority = 0` → always included (e.g., web-search)
- `triggerKeywords` → included if any keyword appears in the user message or pinned context
- `instructionsOnly` → contributes system prompt text only, no tools registered
- `browser-use` skill → skipped if Playwright MCP is connected (MCP provides the tools)
