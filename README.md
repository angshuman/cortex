# Cortex — Personal AI Operating System

[![GitHub Release](https://img.shields.io/github/v/release/angshuman/cortex?style=flat-square&label=Latest%20Release)](https://github.com/angshuman/cortex/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/angshuman/cortex/total?style=flat-square&label=Downloads)](https://github.com/angshuman/cortex/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/angshuman/cortex/release.yml?style=flat-square&label=Build)](https://github.com/angshuman/cortex/actions)

A local-first personal operating system with an AI reasoner, note-taking, task management, and browser automation via MCP. Built with Node.js, TypeScript, React, and Tailwind CSS.

---

## Download

**[Go to the Releases page to download Cortex](https://github.com/angshuman/cortex/releases/latest)**

### Latest Release (v1.1.0)

- **Windows (x64):** [Cortex-Setup-1.1.0.exe](https://github.com/angshuman/cortex/releases/download/v1.1.0/Cortex-Setup-1.1.0.exe)
- **Windows (ARM64):** [Cortex-Setup-1.1.0.exe](https://github.com/angshuman/cortex/releases/download/v1.1.0/Cortex-Setup-1.1.0.exe) (ARM64 NSIS installer)
- **macOS (Apple Silicon):** [Cortex-1.1.0-arm64.dmg](https://github.com/angshuman/cortex/releases/download/v1.1.0/Cortex-1.1.0-arm64.dmg)
- **macOS (Intel):** [Cortex-1.1.0.dmg](https://github.com/angshuman/cortex/releases/download/v1.1.0/Cortex-1.1.0.dmg)
- **Linux (AppImage):** [Cortex-1.1.0.AppImage](https://github.com/angshuman/cortex/releases/download/v1.1.0/Cortex-1.1.0.AppImage)
- **Linux (Debian/Ubuntu):** [cortex_1.1.0_amd64.deb](https://github.com/angshuman/cortex/releases/download/v1.1.0/cortex_1.1.0_amd64.deb)

> On first launch, a setup dialog asks for an API key (OpenAI, Anthropic, xAI, or Google Gemini). No environment variables needed.

---

## Features

- **AI Chat & Reasoning** — Converse with Claude, OpenAI, Grok, or Gemini. The agent reasons through problems, creates notes, manages tasks, and uses tools.
- **Notes** — Full markdown editor with image support (paste screenshots), folder hierarchy, inbox quick dump, and rendered preview.
- **Tasks** — Pure no-AI task management with kanban and list views, subtasks, priorities, due dates, and status tracking.
- **Search** — Unified search across notes, tasks, and chat history. Configurable for local keyword or OpenAI vector search.
- **Skills System** — Extensible tools the AI agent can use. Built-in skills for note-taking, task management, web search, and browser automation.
- **Browser Use (MCP)** — Connect a Playwright MCP server for real browser automation.
- **Multi-Vault Workspaces** — Separate vaults for work, personal, etc. Each with its own notes, tasks, and chats.
- **API Key Management** — Add, verify, and manage API keys from the UI. No env vars required.
- **Local Filesystem** — All data stored as plain JSON and Markdown files. Human-readable, navigable, portable.
- **Sync** — Point vault folders to OneDrive, Google Drive, USB, or any path for portability.
- **Desktop App** — Native Electron app with system tray, single-instance lock, and platform menus.

## Data Structure

```
.cortex-data/
├── vaults/
│   ├── personal/
│   │   ├── notes/          # Markdown files + index
│   │   ├── tasks/          # tasks.json
│   │   ├── chat/           # Session files
│   │   ├── skills/         # Skill definitions
│   │   └── files/          # Uploaded assets
│   └── work/
│       └── ...
├── vaults.json             # Vault registry
└── config.json             # Global settings + API keys
```

## Quick Start (Development)

```bash
git clone https://github.com/angshuman/cortex.git
cd cortex
npm install
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) — the API key setup dialog will appear on first launch.

You can also set keys via environment variables:

```bash
# macOS / Linux / Git Bash
export OPENAI_API_KEY=sk-...

# Windows PowerShell
$env:OPENAI_API_KEY = "sk-..."
```

> **Tip:** Create a `.env` file in the project root for persistent config:
> ```
> OPENAI_API_KEY=sk-...
> CORTEX_DATA_DIR=C:\Users\you\OneDrive\cortex-data
> ```

## Electron Desktop App

```bash
# Dev mode — build + launch
npm run electron:dev

# Package for your platform
npm run electron:pack:win     # Windows .exe installer
npm run electron:pack:mac     # macOS .dmg
npm run electron:pack:linux   # Linux .AppImage + .deb
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GROK_API_KEY` | Grok/xAI API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `CORTEX_DATA_DIR` | Custom data directory (default: `.cortex-data/`) |

### Settings UI

- **API Keys** — Add, verify, and manage provider keys from Settings > General.
- **AI Provider** — Auto-detected from first configured key. Override model per-vault.
- **Vector Search** — Local keyword or OpenAI embeddings.
- **MCP Servers** — Add Playwright or custom MCP servers for extended capabilities.
- **Agent Tuning** — Max turns, temperature, token limits, custom system prompt.
- **Data Directory** — Shown in settings. Sync vault folders for portability.

## Skills

Built-in skills (always available):

| Skill | Tools | Description |
|---|---|---|
| **note-taker** | `create_note`, `read_note`, `list_notes`, `update_note` | Manage notes |
| **task-manager** | `create_task`, `list_tasks`, `update_task`, `complete_task` | Manage tasks |
| **web-search** | `web_search` | Search the web |
| **browser-use** | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_snapshot` | Browser automation via MCP |

Add custom skills via the Skills JSON in your vault's `skills/skills.json`.

## Tech Stack

- **Backend**: Express + TypeScript, filesystem storage, WebSocket for real-time chat
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Desktop**: Electron with system tray and native menus
- **AI**: Anthropic SDK, OpenAI SDK (also used for Grok and Gemini via compatible API)
- **Markdown**: `marked` for rendering
- **Icons**: `lucide-react`
- **Build**: Vite (client) + esbuild (server + Electron) + electron-builder (packaging)
- **CI/CD**: GitHub Actions — auto-builds Windows/macOS/Linux on tag push

## Architecture

- No database — everything is JSON/Markdown files on disk
- AI agent has a reasoning loop with tool use (configurable depth per message)
- WebSocket streams agent events (thoughts, tool calls, results, messages) to the UI
- Skills define tools the agent can invoke, with parameters and instructions
- MCP browser support is built into the skill system
- Electron wraps the Express server + React client into a native desktop app

## Code Signing

The binaries are currently unsigned. To enable code signing, add these GitHub repository secrets:

**Windows:**
- `WIN_CERT_P12_BASE64` — Base64-encoded .p12 certificate
- `WIN_CERT_PASSWORD` — Certificate password

**macOS:**
- `MAC_CERT_P12_BASE64` — Base64-encoded Developer ID Application .p12
- `MAC_CERT_PASSWORD` — Certificate password
- `APPLE_ID` — Apple ID for notarization
- `APPLE_APP_SPECIFIC_PASSWORD` — App-specific password
- `APPLE_TEAM_ID` — Apple Developer Team ID

## License

MIT
