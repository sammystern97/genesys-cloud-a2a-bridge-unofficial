// ── A2A Protocol Types ────────────────────────────────────────────────────────

export interface A2ATextPart {
  type: "text";
  text: string;
}

export interface A2ADataPart {
  type: "data";
  data: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2ADataPart;

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
}

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2ATask {
  id: string;
  sessionId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskSendParams {
  id: string;
  sessionId?: string;
  message: A2AMessage;
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

export interface A2ATaskGetParams {
  id: string;
  historyLength?: number;
}

export interface A2ATaskCancelParams {
  id: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// A2A JSON-RPC error codes
export const A2A_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
} as const;

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

// ── Genesys Open Messaging Types ──────────────────────────────────────────────

export interface GenesysOpenMessage {
  channel: {
    messageId: string;
    platform: "Open";
    type: "Private";
    to: {
      id: string;
    };
    from: {
      id: string;
      idType: "Opaque";
      firstName?: string;
      lastName?: string;
    };
    time: string;
  };
  type: "Text" | "Structured" | "Receipt" | "Event";
  text?: string;
  content?: unknown[];
  originatingEntity?: "Human" | "Bot";
  metadata?: Record<string, string>;
}

export interface GenesysOpenMessageResponse {
  id: string;
  channel: {
    messageId: string;
    platform: string;
    type: string;
    to: { id: string };
    from: { id: string };
    time: string;
  };
  type: string;
  text?: string;
  status: string;
  createdBy: { id: string };
  createdDate: string;
  conversation: { id: string };
}

export interface GenesysNotificationMessage {
  topicName: string;
  eventBody: GenesysConversationMessageEvent;
}

export interface GenesysConversationMessageEvent {
  id: string;
  participants?: GenesysParticipant[];
  messages?: GenesysMessage[];
}

export interface GenesysParticipant {
  id: string;
  purpose: string;
  state: string;
  userId?: string;
}

export interface GenesysMessage {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  status: string;
  normalizedMessage?: {
    type: string;
    text?: string;
    content?: unknown[];
  };
  textBody?: string;
  fromAddress?: string;
  toAddress?: string;
  time?: string;
  timestamp?: string;
}

// ── Internal Bridge State ─────────────────────────────────────────────────────

export interface PendingConversation {
  taskId: string;
  sessionId: string;
  genesysConversationId: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export type GenesysRegion =
  | "us-east-1"
  | "us-west-2"
  | "eu-west-1"
  | "eu-central-1"
  | "eu-west-2"
  | "ap-southeast-2"
  | "ap-northeast-1"
  | "ap-south-1"
  | "ca-central-1"
  | "us-gov-west-1";

export const REGION_BASE_URLS: Record<GenesysRegion, string> = {
  "us-east-1": "https://api.mypurecloud.com",
  "us-west-2": "https://api.usw2.pure.cloud",
  "eu-west-1": "https://api.mypurecloud.ie",
  "eu-central-1": "https://api.mypurecloud.de",
  "eu-west-2": "https://api.euw2.pure.cloud",
  "ap-southeast-2": "https://api.mypurecloud.com.au",
  "ap-northeast-1": "https://api.mypurecloud.jp",
  "ap-south-1": "https://api.aps1.pure.cloud",
  "ca-central-1": "https://api.cac1.pure.cloud",
  "us-gov-west-1": "https://api.use2.us-gov-pure.cloud",
};

export const REGION_AUTH_URLS: Record<GenesysRegion, string> = {
  "us-east-1": "https://login.mypurecloud.com",
  "us-west-2": "https://login.usw2.pure.cloud",
  "eu-west-1": "https://login.mypurecloud.ie",
  "eu-central-1": "https://login.mypurecloud.de",
  "eu-west-2": "https://login.euw2.pure.cloud",
  "ap-southeast-2": "https://login.mypurecloud.com.au",
  "ap-northeast-1": "https://login.mypurecloud.jp",
  "ap-south-1": "https://login.aps1.pure.cloud",
  "ca-central-1": "https://login.cac1.pure.cloud",
  "us-gov-west-1": "https://login.use2.us-gov-pure.cloud",
};

export interface BridgeConfig {
  clientId: string;
  clientSecret: string;
  region: GenesysRegion;
  openMessagingIntegrationId: string;
  agentName: string;
  agentDescription: string;
  agentBaseUrl: string;
  port: number;
  responseTimeoutMs: number;
}
