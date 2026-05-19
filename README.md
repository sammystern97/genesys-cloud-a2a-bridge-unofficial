# Genesys A2A Bridge

A [Google Agent2Agent (A2A) protocol](https://google.github.io/A2A/) server that exposes a Genesys Cloud Agentic Virtual Agent (AVA) — connected to an Architect Bot Flow and a Messenger deployment — as a standard A2A endpoint. External agents can send tasks to this server exactly as they would to any other A2A-compliant agent.

## How It Works

```
External Agent
     │
     │  POST /  (JSON-RPC 2.0 — tasks/send)
     ▼
Genesys A2A Bridge
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
     │  A2A Task result
     ▼
External Agent
```

Each A2A task maps to a Genesys Open Messaging conversation. The bridge:
1. Sends the user text as an inbound Open Message
2. Subscribes to `v2.conversations.<id>.messages` on the Notifications WebSocket
3. Waits for the first outbound message from the Bot Flow / AVA
4. Returns that message as the A2A task artifact

Multi-turn continuity is preserved by reusing the `sessionId` across tasks — Genesys routes returning senders to the same conversation context.

## Prerequisites

- Node.js 18+
- A Genesys Cloud organization with:
  - An **Open Messaging integration** (Admin > Messaging > Open Messaging)
  - An **Architect Bot Flow** configured to use that integration (or a Digital Bot Flow connected to it)
  - An **AVA** configured within the Bot Flow
  - An OAuth 2.0 **Client Credentials** client with roles covering:
    - `conversations:message:create` and `conversations:message:view`
    - `notifications:subscription:add`

## Setup

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
# Edit .env with your credentials
```

| Variable | Required | Description |
|---|---|---|
| `GENESYS_CLIENT_ID` | ✓ | OAuth 2.0 Client ID |
| `GENESYS_CLIENT_SECRET` | ✓ | OAuth 2.0 Client Secret |
| `GENESYS_REGION` | ✓ | e.g. `us-east-1` |
| `GENESYS_OPEN_MESSAGING_INTEGRATION_ID` | ✓ | UUID of the Open Messaging integration |
| `AGENT_BASE_URL` | ✓ | Public URL of this server (used in Agent Card) |
| `AGENT_NAME` | | Display name (default: `Genesys AVA`) |
| `AGENT_DESCRIPTION` | | Agent Card description |
| `PORT` | | HTTP port (default: `3000`) |
| `RESPONSE_TIMEOUT_MS` | | AVA response timeout (default: `30000`) |

### 5. Start the Server

```bash
# Production
npm start

# Development (watch mode)
npm run dev
```

## A2A Endpoints

| Endpoint | Description |
|---|---|
| `GET /.well-known/agent.json` | Agent Card — describes the agent to callers |
| `POST /` | A2A task endpoint (JSON-RPC 2.0) |
| `GET /health` | Health check |

## Example: Send a Task

```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
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

Response (once AVA replies):
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "id": "task-abc123",
    "sessionId": "session-user-42",
    "status": {
      "state": "completed",
      "timestamp": "2025-01-01T12:00:05Z"
    },
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

## Architecture

```
src/
├── index.ts          # Express server entry, env config
├── agent-card.ts     # A2A Agent Card builder
├── a2a-router.ts     # JSON-RPC 2.0 dispatch (tasks/send, tasks/get, tasks/cancel)
├── task-manager.ts   # In-memory task state and lifecycle
├── genesys-bridge.ts # Open Messaging sender + Notifications WebSocket receiver
├── auth.ts           # OAuth 2.0 client credentials + token cache
└── types.ts          # A2A protocol types, Genesys types, config
```

## Production Considerations

**Persistence**
Task state is in-memory and lost on restart. For durability, replace `TaskManager`'s `Map` with Redis or a database. The `prune()` method already handles TTL-based cleanup.

**WebSocket Reconnection**
The bridge reconnects automatically on WebSocket close, but Genesys notification channel IDs are short-lived. On reconnect, re-subscribe any active conversations; consider storing pending conversations in Redis so they survive a restart.

**Scaling**
A single WebSocket channel handles all conversation notifications. Genesys rate-limits channels per OAuth client. For high volume, shard conversations across multiple channel connections or use a Genesys EventBridge integration instead.

**Authentication**
The A2A protocol does not mandate caller authentication in its base spec. Add an API key or OAuth middleware to the Express routes before deploying publicly:
```typescript
app.use((req, res, next) => {
  if (req.headers["x-api-key"] !== process.env.A2A_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});
```

**Streaming (tasks/sendSubscribe)**
The current implementation resolves synchronously. For streaming responses (partial AVA output), extend `a2a-router.ts` to use Server-Sent Events: set `Content-Type: text/event-stream`, emit `TaskStatusUpdateEvent` frames as each outbound message arrives, and close the stream when the conversation reaches a terminal state.

**Timeout Tuning**
The default 30-second timeout covers most Bot Flow responses. Flows with complex NLU processing or agent hand-off prompts may need longer. Set `RESPONSE_TIMEOUT_MS` accordingly, or add per-skill timeout overrides.
