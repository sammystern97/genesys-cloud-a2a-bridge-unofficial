# Genesys Data Actions for A2A Agents

Ready-to-import Genesys Cloud Data Action files that let any Architect flow call an external A2A-compliant agent over HTTP. No bridge server required.

## Available Actions

| File | Auth | Description |
|---|---|---|
| [`send-task-generic-apikey.json`](./send-task-generic-apikey.json) | API key (`x-api-key`) | Send a text message to any A2A endpoint. Works with any compliant agent, including the bridge server in this repo. |
| [`send-task-google-adk-bearer.json`](./send-task-google-adk-bearer.json) | OIDC Bearer token | Send a task to a Google ADK agent. Forwards the Genesys conversation ID as A2A metadata so the ADK agent can correlate calls. Also returns the agent's `statusMessage` for escalation reasons. |
| [`send-task-langgraph-structured.json`](./send-task-langgraph-structured.json) | API key | Send a task to a LangGraph agent with structured customer context (`customerId`, `accountNumber`, `locale`) as a `data` part alongside the message. Maps back `intentDetected`, `suggestedAction`, and `confidence` from the response. |
| [`get-task-status.json`](./get-task-status.json) | API key | Poll an A2A agent for the current state of a previously submitted task. Use inside an Architect Loop to wait on long-running agent tasks. |

## Setup

### 1. Create a Custom REST Actions integration

1. Go to **Admin > Integrations**
2. Click **+ Integrations** and search for **Custom REST Actions**
3. Install it and give it a name (e.g., "A2A Agents")
4. Under **Configuration > Credentials**, add your credential:
   - For API key actions: add a field named `apiKey` with your key value
   - For Bearer token actions: add a field named `bearerToken` with your token

### 2. Import a Data Action

1. Go to **Admin > Integrations > Actions**
2. Click **Import**
3. Select one of the JSON files from this folder
4. Genesys will ask you to associate the action with your Custom REST Actions integration — select the one you created above

### 3. Update the URL

After import, open the action and change `requestUrlTemplate` to point at your A2A agent:

```
https://your-a2a-agent-url   →   https://my-agent.example.com
```

Save and **Publish** the action.

### 4. Wire it into an Architect flow

In any Architect Bot Flow, Inbound Message Flow, or Digital Bot Flow:

1. Add a **Call Data Action** step
2. Select your imported action
3. Map flow variables to the input fields:

| Input | Recommended value | Purpose |
|---|---|---|
| `taskId` | `ToString(Conversation.Id) + "-" + ToString(Flow.InvocationCount)` | Unique per call |
| `sessionId` | `ToString(Conversation.Id)` | Reuse across turns for multi-turn context |
| `message` | The customer's utterance variable | What to send to the agent |

4. Map output variables:

| Output | What it contains |
|---|---|
| `responseText` | The agent's natural language reply |
| `taskState` | `completed`, `failed`, `canceled`, or `input-required` |

5. Use a **Say** or **Send Response** step to deliver the reply to the customer

## Patterns

### Multi-turn conversations

Reuse the same `sessionId` across Data Action calls within the same conversation. A2A agents use this to look up prior context:

```
Turn 1:  sessionId = "conv-123",  message = "What's my balance?"
Turn 2:  sessionId = "conv-123",  message = "And the due date?"
         ↑ agent remembers turn 1
```

### Polling for long-running tasks

Some agents return `taskState: working` before their answer is ready. Use `get-task-status` in an Architect **Loop**:

```
[Call Data Action: send-task-generic-apikey]  →  store taskId
[Loop while taskState == "working" AND loopCount < 15]
  [Wait 2 seconds]
  [Call Data Action: get-task-status]  →  update taskState, responseText
[End Loop]
[Say responseText]
```

### Branching on agent intent

The LangGraph structured action returns `intentDetected` and `suggestedAction`. Use a **Decision** step to route the flow:

```
[Call Data Action: send-task-langgraph-structured]
[Decision: suggestedAction]
  "transfer"  → [Transfer to Queue]
  "escalate"  → [Transfer to Agent]
  "self-serve" → [Say responseText, continue flow]
  default     → [Say responseText]
```

### Sending structured context

The LangGraph and Google ADK actions demonstrate passing structured data alongside the text message. A2A supports this via `data` parts:

```json
"parts": [
  { "type": "text", "text": "What's my balance?" },
  { "type": "data", "data": { "customerId": "C-12345", "accountNumber": "9876" } }
]
```

This avoids the agent having to extract structured fields from natural language. You can adapt any action's `requestTemplate` to include additional data parts.

## Customizing an Action

Each JSON file is a standard Genesys Data Action export. To customize:

1. **Add inputs**: Add properties to `contract.input.inputSchema.properties` and reference them in the `requestTemplate` as `${input.yourFieldName}`
2. **Add outputs**: Add JSONPath expressions to `config.response.translationMap` and corresponding properties to `contract.output.successSchema.properties`
3. **Change auth**: Switch between `x-api-key` and `Authorization: Bearer` in the `headers` block, and update the credential reference accordingly
4. **Add metadata**: Extend the `metadata` object in the request template to pass additional context (queue name, agent skills, routing priority, etc.)
