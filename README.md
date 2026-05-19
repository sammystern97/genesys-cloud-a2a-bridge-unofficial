# Genesys Cloud ↔ A2A Protocol (Unofficial)

Connect Genesys Cloud with any [Google Agent2Agent (A2A)](https://google.github.io/A2A/) compliant agent — in either direction.

> **Unofficial.** This project is not affiliated with or supported by Genesys or Google.

## Table of Contents

**[Two Integration Patterns](#two-integration-patterns)** — decision table to pick your approach

**Inbound Bridge** — external agents call your Genesys AVA
- [How It Works](#how-it-works)
- [Security](#security) — [OIDC Bearer Token](#option-a--oidc-bearer-token-recommended) · [Static API Key](#option-b--static-api-key)
- [Prerequisites](#prerequisites)
- [Bridge Setup](#bridge-setup) — [Open Messaging](#1-create-an-open-messaging-integration) · [Bot Flow](#2-connect-the-bot-flow) · [Install](#3-install-and-build) · [Environment](#4-configure-environment) · [Start](#5-start-the-server)
- [A2A Endpoints](#a2a-endpoints)
- [Agent Card](#agent-card)
- [Example: Send a Task](#example-send-a-task)
- [Supported A2A Methods](#supported-a2a-methods)

**Outbound Data Actions** — Genesys flows call external A2A agents
- [Overview](#outbound-data-actions-genesys-flows--external-a2a-agents)
- [Example Data Actions](#example-data-actions)
- [Quick Start](#quick-start)

**Reference**
- [Architecture (Bridge Server)](#architecture-bridge-server)
- [Production Considerations](#production-considerations)

---

## Two Integration Patterns

This repo covers two independent patterns. Pick the one that matches your use case — or use both.

| | **Inbound Bridge** | **Outbound Data Actions** |
|---|---|---|
| **Direction** | External agent → Genesys AVA | Genesys flow → external agent |
| **What it does** | Exposes a Genesys AVA as a standard A2A endpoint so external agents can send it tasks | Lets Architect flows call any external A2A agent via Genesys Data Actions |
| **You deploy** | A Node.js bridge server (`src/`) | Nothing — import JSON files into Genesys Admin |
| **When to use** | You have an external orchestrator (Google ADK, LangGraph, etc.) that needs to talk to your Genesys bot | Your Genesys flow needs to consult an external AI agent mid-conversation |
| **Section** | [Inbound Bridge →](#inbound-bridge-external-agents--genesys-ava) | [Outbound Data Actions →](#outbound-data-actions-genesys-flows--external-a2a-agents) |

---

# Inbound Bridge: External Agents → Genesys AVA

A Node.js server that implements the A2A protocol and translates tasks into Genesys Open Messaging conversations. External agents send JSON-RPC 2.0 requests to this server; it forwards them to your Architect Bot Flow / AVA and returns the reply.

## How It Works

```
External A2A Agent
     │
     │  POST /  (JSON-RPC 2.0 — tasks/send)
     │  Authorization: Bearer <oidc-token>  OR  x-api-key: <key>
     ▼
Genesys A2A Bridge  (this server)
     │
     │  POST /api/v2/conversations/messages/inbound/open
     ▼
Genesys Open Messaging Integration
     │
     │  routes to
     ▼
Architect Bot Flow ──► AVA (Agentic Virtual Agent)
     │
     │  outbound message via Notifications WebSocket
     ▼
Genesys A2A Bridge
     │
     │  A2A Task result (artifact)
     ▼
External A2A Agent
```

Each A2A task maps to a Genesys Open Messaging conversation. The bridge:
1. Validates the caller's credentials (OIDC token or API key)
2. Sends the user text as an inbound Open Message to Genesys
3. Subscribes to `v2.conversations.<id>.messages` on the Notifications WebSocket
4. Waits for the first outbound message from the Bot Flow / AVA
5. Returns that message as the A2A task artifact

Multi-turn continuity is preserved by reusing the `sessionId` across tasks — Genesys routes returning senders to the same conversation context.

## Security

The A2A task endpoint (`POST /`) requires caller authentication. Two schemes are supported and advertised in the Agent Card's `securitySchemes` block:

### Option A — OIDC Bearer Token (recommended)

Best for agent-to-agent trust between known systems (e.g., a Google ADK agent calling a Genesys AVA).

**How it works:**
1. The calling agent obtains a JWT from its OIDC provider (e.g., Google, Okta, Azure AD)
2. It sends `Authorization: Bearer <jwt>` with each request
3. The bridge fetches the provider's JWKS from `${OIDC_ISSUER}/.well-known/jwks.json` and verifies the signature, expiry, issuer, and audience

**Configure:**
```
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=your-expected-audience-claim
```

The JWKS response is cached in memory; the bridge will re-fetch keys automatically if verification fails (key rotation).

### Option B — Static API Key

Best for trusted internal callers or quick integration testing.

**How it works:**
1. The calling agent sends `x-api-key: <key>` with each request
2. The bridge hashes the incoming value with SHA-256 and compares it against the stored set
3. Comparison is constant-time against hashes so raw keys are never held in memory after startup

**Configure:**
```
# Comma-separated; values may be raw strings or pre-hashed SHA-256 hex digests
A2A_API_KEYS=your-secret-key-1,your-secret-key-2
```

Generate a key:
```bash
openssl rand -hex 32
```

Hash a key for storage (store the hash, not the raw value):
```bash
echo -n "your-key" | sha256sum | awk '{print $1}'
```

### Both schemes can be active simultaneously

When both `OIDC_ISSUER` and `A2A_API_KEYS` are set, the bridge accepts either credential. The `securitySchemes` in the Agent Card will advertise both options to callers.

### Public endpoints (no auth required)

| Path | Reason |
|---|---|
| `GET /.well-known/agent.json` | Callers must read the Agent Card to discover auth requirements before they can authenticate |
| `GET /health` | Infrastructure health checks |

### What happens with no auth configured

The server starts and logs a prominent warning:
```
[auth] WARNING: No authentication configured. Set OIDC_ISSUER and/or A2A_API_KEYS
       before exposing this server publicly.
```
All task requests will be rejected with `401 Unauthorized`. This is intentional — the server does not silently pass unauthenticated traffic to your Genesys environment.

## Prerequisites

- Node.js 18+
- A Genesys Cloud organization with:
  - An **Open Messaging integration** (Admin > Messaging > Open Messaging)
  - An **Architect Bot Flow** configured to use that integration
  - An **AVA** configured within the Bot Flow
  - An OAuth 2.0 **Client Credentials** client with roles covering:
    - `conversations:message:create` and `conversations:message:view`
    - `notifications:subscription:add`

## Bridge Setup

### 1. Create an Open Messaging Integration

1. Go to **Admin > Messaging > Open Messaging**
2. Click **+ New Integration**
3. Give it a name (e.g., "A2A Bridge")
4. Note the **Integration ID** from the URL or API

### 2. Connect the Bot Flow

In **Architect**, open your Bot Flow (or Digital Bot Flow):

1. Under **Messaging** settings, select the Open Messaging integration you created
2. Ensure the flow is published
3. In **Genesys Admin > Routing > Message Routing**, add a route that matches the integration and points to your flow

### 3. Install and Build

```bash
npm install
npm run build
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials and auth config
```

| Variable | Required | Description |
|---|---|---|
| `GENESYS_CLIENT_ID` | ✓ | OAuth 2.0 Client ID |
| `GENESYS_CLIENT_SECRET` | ✓ | OAuth 2.0 Client Secret |
| `GENESYS_REGION` | ✓ | e.g. `us-east-1` |
| `GENESYS_OPEN_MESSAGING_INTEGRATION_ID` | ✓ | UUID of the Open Messaging integration |
| `AGENT_BASE_URL` | ✓ | Public URL of this server (used in Agent Card) |
| `OIDC_ISSUER` | ✓ (or API key) | OIDC provider base URL |
| `OIDC_AUDIENCE` | | Expected `aud` claim in incoming JWTs |
| `A2A_API_KEYS` | ✓ (or OIDC) | Comma-separated raw or SHA-256-hashed keys |
| `AGENT_NAME` | | Display name (default: `Genesys AVA`) |
| `AGENT_DESCRIPTION` | | Agent Card description |
| `PORT` | | HTTP port (default: `3000`) |
| `RESPONSE_TIMEOUT_MS` | | AVA response timeout in ms (default: `30000`) |

### 5. Start the Server

```bash
# Production
npm start

# Development (watch mode)
npm run dev
```

Startup output:
```
[a2a-bridge] Genesys AVA listening on port 3000
[a2a-bridge] Agent Card: https://your-server/.well-known/agent.json
[a2a-bridge] Region: us-east-1
[a2a-bridge] Auth: OIDC (https://accounts.google.com) + API key
```

## A2A Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /.well-known/agent.json` | None | Agent Card — capabilities, skills, security schemes |
| `POST /` | Required | A2A task endpoint (JSON-RPC 2.0) |
| `GET /health` | None | Health check |

## Agent Card

Fetch the Agent Card to discover how to connect:

```bash
curl https://your-server/.well-known/agent.json
```

```json
{
  "name": "Genesys AVA",
  "description": "Genesys Cloud Agentic Virtual Agent...",
  "url": "https://your-server",
  "version": "1.0.0",
  "securitySchemes": {
    "oidcBearer": {
      "type": "http",
      "scheme": "bearer",
      "bearerFormat": "JWT",
      "description": "OIDC JWT issued by https://accounts.google.com. Include as Authorization: Bearer <token>."
    },
    "apiKey": {
      "type": "apiKey",
      "in": "header",
      "name": "x-api-key",
      "description": "Static API key. Include as x-api-key: <key> header."
    }
  },
  "security": [{ "oidcBearer": [] }, { "apiKey": [] }],
  "capabilities": { "streaming": false, "stateTransitionHistory": true },
  "skills": [{ "id": "chat", "name": "Conversational AI", ... }]
}
```

## Example: Send a Task

```bash
# With API key
curl -X POST https://your-server \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tasks/send",
    "params": {
      "id": "task-abc123",
      "sessionId": "session-user-42",
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "What are your business hours?" }]
      }
    }
  }'
```

```bash
# With OIDC Bearer token
curl -X POST https://your-server \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{ ... }'
```

Response (once AVA replies):
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "id": "task-abc123",
    "sessionId": "session-user-42",
    "status": { "state": "completed", "timestamp": "2025-01-01T12:00:05Z" },
    "artifacts": [{
      "parts": [{ "type": "text", "text": "We're open Monday–Friday, 9am–5pm Eastern." }],
      "index": 0,
      "lastChunk": true
    }]
  }
}
```

## Supported A2A Methods

| Method | Description |
|---|---|
| `tasks/send` | Submit a task and block until the AVA responds |
| `tasks/get` | Retrieve task status and history by ID |
| `tasks/cancel` | Cancel a pending task |

---

# Outbound Data Actions: Genesys Flows → External A2A Agents

No bridge server needed. Import a Data Action JSON file into Genesys Cloud and call any external A2A agent directly from an Architect flow.

```
Architect Flow (Bot Flow, Inbound Message Flow, Digital Bot Flow)
     │
     │  Data Action — POST / (JSON-RPC 2.0 tasks/send)
     │  x-api-key or Authorization: Bearer <token>
     ▼
External A2A Agent  (Google ADK, LangGraph, CrewAI, this bridge, …)
     │
     │  JSON-RPC 2.0 response — artifacts[0].parts[0].text
     ▼
Architect Flow continues with agent reply
```

A Data Action is a reusable HTTP integration block you drop into any Architect flow. Import one of the provided JSON files, point it at your A2A endpoint, attach credentials, and the flow can send tasks to any A2A-compliant agent and read the reply.

## Example Data Actions

Four ready-to-import files are in the [`data-actions/`](./data-actions/) folder:

| File | Auth | Use case |
|---|---|---|
| [`send-task-generic-apikey.json`](./data-actions/send-task-generic-apikey.json) | API key (`x-api-key`) | Works with any A2A endpoint, including this bridge |
| [`send-task-google-adk-bearer.json`](./data-actions/send-task-google-adk-bearer.json) | OIDC Bearer token | Google ADK agents; forwards Genesys conversation ID as metadata |
| [`send-task-langgraph-structured.json`](./data-actions/send-task-langgraph-structured.json) | API key | LangGraph agents; sends customer context as a structured `data` part alongside the message |
| [`get-task-status.json`](./data-actions/get-task-status.json) | API key | Poll task state — use in an Architect Loop to wait on long-running tasks |

See [`data-actions/README.md`](./data-actions/README.md) for full setup instructions, Architect wiring, multi-turn patterns, and async polling.

## Quick Start

1. **Admin > Integrations** → install a **Custom REST Actions** integration → add your API key or Bearer token as a credential
2. **Admin > Integrations > Actions** → **Import** → select a JSON file from `data-actions/`
3. Open the action → update the `requestUrlTemplate` to your agent's URL → **Publish**
4. In Architect, add a **Call Data Action** step → map `taskId`, `sessionId`, `message` → use the `responseText` output

---

# Architecture (Bridge Server)

```
src/
├── index.ts                # Express server entry, env config, middleware wiring
├── agent-card.ts           # A2A Agent Card builder (includes securitySchemes)
├── a2a-router.ts           # JSON-RPC 2.0 dispatch (tasks/send, tasks/get, tasks/cancel)
├── task-manager.ts         # In-memory task state and lifecycle
├── genesys-bridge.ts       # Open Messaging sender + Notifications WebSocket receiver
├── auth.ts                 # Genesys OAuth 2.0 client credentials + token cache
├── types.ts                # A2A protocol types, Genesys types, config
└── middleware/
    └── auth.ts             # OIDC Bearer + API key validation middleware
```

# Production Considerations

**Persistence**
Task state is in-memory and lost on restart. Replace `TaskManager`'s internal `Map` with Redis or a database. The `prune()` method handles TTL-based cleanup for completed tasks.

**WebSocket Reconnection**
The bridge reconnects automatically on WebSocket close, but Genesys notification channel IDs are short-lived. On reconnect, re-subscribe any active conversations. For high-reliability deployments, store pending conversations in Redis so they survive a process restart.

**Scaling**
A single WebSocket channel handles all conversation notifications. For high volume, shard conversations across multiple channel connections or switch to a Genesys EventBridge integration.

**Streaming (tasks/sendSubscribe)**
The current implementation resolves synchronously. For streaming responses, extend `a2a-router.ts` to use Server-Sent Events: set `Content-Type: text/event-stream`, emit `TaskStatusUpdateEvent` frames as each outbound message arrives, and close the stream when the conversation reaches a terminal state.

**Timeout Tuning**
The default 30-second timeout covers most Bot Flow responses. Flows with complex NLU or agent hand-off prompts may need more. Set `RESPONSE_TIMEOUT_MS` accordingly.

**OIDC Key Rotation**
The JWKS fetcher (`jose`'s `createRemoteJWKSet`) caches keys in memory and automatically re-fetches when a known key ID is not found. No manual intervention is needed for standard key rotation.
