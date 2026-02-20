# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

K-Portal AI Cowork Web v5 — an enterprise AI-powered file collaboration and task management system. Users authenticate via K-Portal JWT SSO, interact with Claude AI through real-time WebSocket chat, and manage files in isolated per-user workspaces.

## Running the Server

```bash
# Install dependencies (no requirements.txt — install manually)
pip install fastapi uvicorn motor aiofiles httpx anthropic python-dotenv pyjwt openpyxl

# Run server (reads .env from same directory)
python server.py
# Starts on https://0.0.0.0:5012 (or http if SSL not configured)
```

All configuration is in `.env` (same directory as server.py). The server auto-loads it on startup.

## Architecture

### Single-file Backend
The entire backend is `server.py` (~5200 lines). There is no module splitting. All routes, business logic, tool definitions, WebSocket handling, and the AI agent loop live in this one file.

### Key Architectural Sections (in order within server.py)

1. **Config & Auth (lines 1–178):** `.env` loading, JWT decode/verify functions (`decode_kportal_jwt`, `userid_from_jwt`)
2. **MongoDB Setup (lines 179–218):** Dual database — `cowork` (app data) and `im_org_info` (org directory). All collections are module-level globals.
3. **API Key Management (lines 219–260):** Round-robin across multiple Anthropic API keys using MongoDB global counter for multi-instance distribution.
4. **Model Selection (lines 261–298):** `select_model()` picks Opus vs Sonnet based on keyword matching in user message. Opus for content creation, Sonnet for simple file operations.
5. **TaskManager Class (lines 441–565):** Manages background AI tasks. Supports distributed multi-server deployment via MongoDB. Tracks running tasks, WebSocket connections, and message buffers per user.
6. **Tool Definitions (lines 570–586):** `TOOLS` list defines Claude's available tools (list_files, read_file, write_file, edit_file, delete_file, create_directory, run_command, search_files, file_info, read_excel, web_search, write_temp_file, figma_get_file/images/styles).
7. **execute_tool (line 963):** Dispatches tool calls to async implementations. All file operations use `safe_path()` to prevent path traversal.
8. **run_agent_background (line 1073):** The core AI agent loop. Streams Claude API responses, handles tool use cycles (max 20 steps), manages retries with API key rotation on rate limits.
9. **HTTP Routes (lines 1368+):** REST API endpoints. All user routes are prefixed with `/{token}/api/...` where `token` is the JWT.
10. **WebSocket Handler (lines 4841–5189):** `_handle_ws()` manages the real-time chat lifecycle — session init/restore, message dispatch, keepalive pings, context compression.
11. **Server Startup (lines 5190+):** Static file mounting, uvicorn launch with optional SSL.

### Frontend
- `static/index.html` — main SPA template (server-side rendered with Python string replacement for branding)
- `static/js/app.js` (~3200 lines) — jQuery-based SPA logic
- `static/css/app.css` — custom styles
- `static/lang/{ko,en,ja,zh}.json` — i18n translation files

### Data Flow
1. User connects via `GET /{jwt_token}` → server decodes JWT, serves index.html
2. Browser opens WebSocket to `/ws/chat/{jwt_token}`
3. User sends message → server creates background `asyncio.Task` via `run_agent_background()`
4. AI response streams back via `tm.broadcast()` → WebSocket `send_json()`
5. Tool calls execute in the user's workspace directory (`WORKSPACE_ROOT/{username}/`)
6. Conversation history persists in MongoDB `chat_logs` collection

### User Workspace Isolation
Each user gets `WORKSPACE_ROOT/{username}/` as their sandbox. `safe_path()` enforces that all file operations stay within this boundary. Project files go under `{workspace}/_projects/{project_id}/`.

### MongoDB Collections
- `chat_logs` — conversation history with `api_history` (for Claude context) and `messages` (for UI display)
- `tasks` — background task tracking (status, timing, model used)
- `task_logs` — REST API task execution logs
- `user_settings` — per-user preferences (including Figma token)
- `shared_folders` — folder sharing permissions between users
- `temp_links` — expiring download links (TTL index)
- `skills` — custom slash-command skills per user
- `projects` — project metadata with instructions and reference files
- `active_sessions` / `active_tasks` — distributed state for multi-instance deployment
- `api_key_state` — global round-robin counter for API key distribution

### Important Patterns

- **All async I/O** uses `aio_*` helper functions (aio_read_text, aio_write_text, aio_run_command, etc.) that wrap thread-based operations for non-blocking execution.
- **Error responses** use `ok(dict)` and `err(message)` helpers that return JSON strings.
- **Authentication** on every HTTP endpoint: extract username via `userid_from_jwt(token)`, return 401/redirect if invalid.
- **Admin detection** combines JWT claims (`role == "admin"`) with `ADMIN_USERS` env var set.
- **Korean encoding fallback chain:** utf-8 → utf-8-sig → cp949 → euc-kr → latin-1 (critical for Korean Windows environments).
- **Context compression:** When conversation grows too long, the WebSocket handler can compress history by summarizing older turns via a Claude API call.
- **Stall detection:** Frontend detects 60-second inactivity and prompts user to wait or cancel.

## Development Notes

- The server uses `python-dotenv` to load `.env` — always restart to pick up changes.
- `.env` contains real credentials (JWT secret, MongoDB URI, API keys). Never commit it.
- `_app_version` for static cache busting is auto-computed from file mtimes if `APP_VERSION` env var is empty.
- Branding is fully configurable via `.env` — app title, logo text, welcome message, assistant name.
- The `index.html` template uses Python f-string-style placeholders (`{APP_BRAND}`, `{APP_VERSION}`, etc.) that get replaced at serve time via `_build_index_cache()`.
- Windows-specific: `IS_WINDOWS` flag adjusts command execution behavior. The server handles Windows paths and UTF-8 console output.
