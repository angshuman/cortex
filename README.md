# Cortex — Personal AI Operating System

A local-first personal operating system with an AI reasoner, note-taking, task management, and browser automation via MCP. Built with Node.js, TypeScript, React, and Tailwind CSS.

## Features

- **AI Chat & Reasoning** — Converse with Claude, OpenAI, or Grok. The agent can reason through problems, create notes, manage tasks, and use tools.
- **Notes** — Full markdown editor with image support (paste screenshots), folder hierarchy, inbox quick dump, and rendered preview.
- **Tasks** — Pure no-AI task management with kanban and list views, subtasks, priorities, due dates, and status tracking.
- **Search** — Unified search across notes, tasks, and chat history. Configurable for local keyword or OpenAI vector search.
- **Skills System** — Extensible tools the AI agent can use. Built-in skills for note-taking, task management, web search, and browser automation.
- **Browser Use (MCP)** — Connect a Playwright MCP server for real browser automation.
- **Local Filesystem** — All data stored as plain JSON and Markdown files. Human-readable, navigable, portable.
- **Sync** — Copy the data directory to OneDrive, Google Drive, USB, or git for portability.

## Data Structure

```
.cortex-data/
├── notes/
│   ├── index.json          # Note metadata
│   ├── files/              # Markdown files (organized by folder)
│   └── assets/             # Attached images
├── tasks/
│   └── tasks.json          # All tasks
├── chat/
│   ├── sessions/           # Individual chat sessions
│   └── sessions-index.json
├── skills/
│   └── skills.json         # Skill definitions
├── search/
└── config.json             # Settings
```

## Quick Start

```bash
git clone https://github.com/angshuman/cortex.git
cd cortex
npm install
```

Set at least one AI provider key, then run:

### macOS / Linux / Git Bash

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or: export OPENAI_API_KEY=sk-...
# or: export GROK_API_KEY=xai-...

npm run dev
```

### Windows PowerShell

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# or: $env:OPENAI_API_KEY = "sk-..."
# or: $env:GROK_API_KEY = "xai-..."

npm run dev
```

### Windows CMD

```cmd
set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Open [http://localhost:5000](http://localhost:5000)

> **Tip:** Create a `.env` file in the project root for persistent config (works on all platforms):
> ```
> ANTHROPIC_API_KEY=sk-ant-...
> CORTEX_DATA_DIR=C:\Users\you\OneDrive\cortex-data
> ```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (checked first) |
| `OPENAI_API_KEY` | OpenAI API key (checked second) |
| `GROK_API_KEY` | Grok/xAI API key (checked third) |
| `CORTEX_DATA_DIR` | Custom data directory (default: `.cortex-data/`) |

### Settings UI

- **AI Provider** — Auto-detected from env. Override model in settings.
- **Vector Search** — Local keyword or OpenAI embeddings.
- **Browser Backend** — None or Playwright MCP.
- **Data Directory** — Shown in settings. Sync this folder for portability.

## Skills

Built-in skills (always available):

| Skill | Tools | Description |
|---|---|---|
| **note-taker** | `create_note`, `read_note`, `list_notes`, `update_note` | Manage notes |
| **task-manager** | `create_task`, `list_tasks`, `update_task`, `complete_task` | Manage tasks |
| **web-search** | `web_search` | Search the web |
| **browser-use** | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_snapshot` | Browser automation via MCP |

Add custom skills via the Skills JSON in `~/.cortex-data/skills/skills.json`.

## Tech Stack

- **Backend**: Express + TypeScript, filesystem storage, WebSocket for real-time chat
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **AI**: Anthropic SDK, OpenAI SDK (also used for Grok via custom baseURL)
- **Markdown**: `marked` for rendering
- **Icons**: `lucide-react`

## Architecture

- No database — everything is JSON/Markdown files on disk
- AI agent has a reasoning loop with tool use (up to 10 steps per message)
- WebSocket streams agent events (thoughts, tool calls, results, messages) to the UI
- Skills define tools the agent can invoke, with parameters and instructions
- MCP browser support is built into the skill system (connect Playwright MCP externally)

## License

MIT
