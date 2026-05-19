import axios, { type AxiosInstance } from "axios";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { GenesysAuth } from "./auth.js";
import type {
  BridgeConfig,
  GenesysOpenMessage,
  GenesysOpenMessageResponse,
  GenesysNotificationMessage,
  PendingConversation,
} from "./types.js";
import { REGION_BASE_URLS } from "./types.js";

export class GenesysBridge {
  private readonly auth: GenesysAuth;
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private ws: WebSocket | null = null;
  private wsChannelId: string | null = null;
  private readonly pending = new Map<string, PendingConversation>();

  constructor(private readonly config: BridgeConfig) {
    this.auth = new GenesysAuth(config.clientId, config.clientSecret, config.region);
    this.baseUrl = REGION_BASE_URLS[config.region];

    this.http = axios.create({ baseURL: `${this.baseUrl}/api/v2` });

    this.http.interceptors.request.use(async (req) => {
      const token = await this.auth.getAccessToken();
      req.headers.Authorization = `Bearer ${token}`;
      return req;
    });

    this.http.interceptors.response.use(undefined, async (error) => {
      if (error.response?.status === 401 && !error.config?._retried) {
        error.config._retried = true;
        this.auth.clearCache();
        const token = await this.auth.getAccessToken();
        error.config.headers.Authorization = `Bearer ${token}`;
        return this.http.request(error.config);
      }
      return Promise.reject(error);
    });
  }

  // ── Notification WebSocket ────────────────────────────────────────────────

  async connect(): Promise<void> {
    const channelResp = await this.http.post<{ id: string; connectUri: string }>(
      "/notifications/channels",
      {}
    );
    this.wsChannelId = channelResp.data.id;
    const connectUri = channelResp.data.connectUri;

    this.ws = new WebSocket(connectUri);

    this.ws.on("message", (data: Buffer) => {
      this.handleNotification(data.toString());
    });

    this.ws.on("close", () => {
      console.error("[bridge] WebSocket closed — reconnecting in 5s");
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on("error", (err) => {
      console.error("[bridge] WebSocket error:", err.message);
    });

    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", resolve);
      this.ws!.once("error", reject);
    });

    console.error(`[bridge] WebSocket connected (channel: ${this.wsChannelId})`);
  }

  private async subscribeToConversation(conversationId: string): Promise<void> {
    if (!this.wsChannelId) throw new Error("WebSocket not connected");
    await this.http.post(`/notifications/channels/${this.wsChannelId}/subscriptions`, {
      entities: [
        { id: `v2.conversations.${conversationId}.messages` },
        { id: `v2.conversations.${conversationId}` },
      ],
    });
  }

  private handleNotification(raw: string): void {
    try {
      const notification = JSON.parse(raw) as GenesysNotificationMessage;
      const topic = notification.topicName ?? "";

      // Match: v2.conversations.<id>.messages
      const msgMatch = topic.match(/^v2\.conversations\.([^.]+)\.messages$/);
      if (!msgMatch) return;

      const conversationId = msgMatch[1];
      const pending = this.findPendingByConversation(conversationId);
      if (!pending) return;

      const messages = notification.eventBody?.messages ?? [];
      for (const msg of messages) {
        // Only pick up outbound messages from the bot/agent side
        if (msg.direction !== "outbound") continue;
        const text =
          msg.normalizedMessage?.text ??
          msg.textBody ??
          "";
        if (!text) continue;

        clearTimeout(pending.timeout);
        this.pending.delete(pending.taskId);
        pending.resolve(text);
        return;
      }
    } catch {
      // ignore unparseable frames (heartbeats, etc.)
    }
  }

  private findPendingByConversation(conversationId: string): PendingConversation | undefined {
    for (const p of this.pending.values()) {
      if (p.genesysConversationId === conversationId) return p;
    }
    return undefined;
  }

  // ── Open Messaging ────────────────────────────────────────────────────────

  async sendAndAwait(
    taskId: string,
    sessionId: string,
    userText: string
  ): Promise<string> {
    // Each A2A task gets its own synthetic sender identity so conversations
    // are isolated per task. Reusing sessionId keeps multi-turn continuity.
    const senderId = sessionId;

    const messageId = uuidv4();
    const body: GenesysOpenMessage = {
      channel: {
        messageId,
        platform: "Open",
        type: "Private",
        to: { id: this.config.openMessagingIntegrationId },
        from: {
          id: senderId,
          idType: "Opaque",
          firstName: "A2A",
          lastName: "Agent",
        },
        time: new Date().toISOString(),
      },
      type: "Text",
      text: userText,
      originatingEntity: "Human",
    };

    const resp = await this.http.post<GenesysOpenMessageResponse>(
      "/conversations/messages/inbound/open",
      body
    );

    const conversationId = resp.data.conversation.id;
    await this.subscribeToConversation(conversationId);

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(taskId);
        reject(new Error(`Timed out waiting for AVA response (conversationId: ${conversationId})`));
      }, this.config.responseTimeoutMs);

      this.pending.set(taskId, {
        taskId,
        sessionId,
        genesysConversationId: conversationId,
        resolve,
        reject,
        timeout,
      });
    });
  }

  // ── Conversation management ───────────────────────────────────────────────

  async endConversation(sessionId: string): Promise<void> {
    // Disconnect the open messaging participant to cleanly end the session
    try {
      const resp = await this.http.get<{ entities: Array<{ id: string }> }>(
        "/conversations/messages",
        { params: { integrationId: this.config.openMessagingIntegrationId } }
      );
      for (const conv of resp.data.entities ?? []) {
        const detail = await this.http.get<{
          participants: Array<{ id: string; purpose: string; state: string; address?: string }>;
        }>(`/conversations/messages/${conv.id}`);
        const externalParticipant = detail.data.participants.find(
          (p) => p.purpose === "customer" && p.address === sessionId && p.state === "connected"
        );
        if (externalParticipant) {
          await this.http.patch(
            `/conversations/messages/${conv.id}/participants/${externalParticipant.id}`,
            { state: "disconnected" }
          );
          break;
        }
      }
    } catch (err) {
      console.error("[bridge] endConversation error:", (err as Error).message);
    }
  }
}
