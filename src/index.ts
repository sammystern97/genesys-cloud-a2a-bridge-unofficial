import express from "express";
import { GenesysBridge } from "./genesys-bridge.js";
import { A2ARouter } from "./a2a-router.js";
import { buildAgentCard } from "./agent-card.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import type { BridgeConfig, GenesysRegion } from "./types.js";
import { REGION_BASE_URLS } from "./types.js";

function getConfig(): BridgeConfig {
  const clientId = process.env.GENESYS_CLIENT_ID;
  const clientSecret = process.env.GENESYS_CLIENT_SECRET;
  const region = (process.env.GENESYS_REGION ?? "us-east-1") as GenesysRegion;
  const integrationId = process.env.GENESYS_OPEN_MESSAGING_INTEGRATION_ID;
  const agentBaseUrl = process.env.AGENT_BASE_URL;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GENESYS_CLIENT_ID or GENESYS_CLIENT_SECRET");
  }
  if (!integrationId) {
    throw new Error("Missing GENESYS_OPEN_MESSAGING_INTEGRATION_ID");
  }
  if (!agentBaseUrl) {
    throw new Error("Missing AGENT_BASE_URL");
  }
  if (!Object.keys(REGION_BASE_URLS).includes(region)) {
    throw new Error(`Invalid GENESYS_REGION: ${region}`);
  }

  // API keys: comma-separated list of raw or pre-hashed (SHA-256 hex) values
  const apiKeys = process.env.A2A_API_KEYS
    ? process.env.A2A_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined;

  return {
    clientId,
    clientSecret,
    region,
    openMessagingIntegrationId: integrationId,
    agentName: process.env.AGENT_NAME ?? "Genesys AVA",
    agentDescription:
      process.env.AGENT_DESCRIPTION ??
      "Genesys Cloud Agentic Virtual Agent connected to an Architect Bot Flow",
    agentBaseUrl,
    port: parseInt(process.env.PORT ?? "3000", 10),
    responseTimeoutMs: parseInt(process.env.RESPONSE_TIMEOUT_MS ?? "30000", 10),
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcAudience: process.env.OIDC_AUDIENCE,
    apiKeys,
  };
}

async function main() {
  const config = getConfig();

  const bridge = new GenesysBridge(config);
  await bridge.connect();

  const a2aRouter = new A2ARouter(bridge);
  const agentCard = buildAgentCard(config);
  const authMiddleware = createAuthMiddleware(config);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  // A2A Agent Card — public, describes the agent and its security requirements
  app.get("/.well-known/agent.json", (_req, res) => {
    res.json(agentCard);
  });

  // A2A task endpoint (JSON-RPC 2.0) — protected
  app.post("/", a2aRouter.handle);

  // Health check — public
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agent: config.agentName });
  });

  app.listen(config.port, () => {
    console.error(`[a2a-bridge] ${config.agentName} listening on port ${config.port}`);
    console.error(`[a2a-bridge] Agent Card: ${config.agentBaseUrl}/.well-known/agent.json`);
    console.error(`[a2a-bridge] Region: ${config.region}`);
    console.error(
      `[a2a-bridge] Auth: ${[
        config.oidcIssuer ? `OIDC (${config.oidcIssuer})` : null,
        config.apiKeys?.length ? "API key" : null,
      ]
        .filter(Boolean)
        .join(" + ") || "NONE — configure OIDC_ISSUER and/or A2A_API_KEYS"}`
    );
  });
}

main().catch((err: Error) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
