import type { AgentCard, BridgeConfig } from "./types.js";

export function buildAgentCard(config: BridgeConfig): AgentCard {
  const securitySchemes: AgentCard["securitySchemes"] = {};
  const security: AgentCard["security"] = [];

  if (config.oidcIssuer) {
    securitySchemes["oidcBearer"] = {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: `OIDC JWT issued by ${config.oidcIssuer}. ` +
        `Include as Authorization: Bearer <token>. ` +
        (config.oidcAudience ? `Expected audience: ${config.oidcAudience}.` : ""),
    };
    security.push({ oidcBearer: [] });
  }

  if (config.apiKeys && config.apiKeys.length > 0) {
    securitySchemes["apiKey"] = {
      type: "apiKey",
      in: "header",
      name: "x-api-key",
      description: "Static API key. Include as x-api-key: <key> header.",
    };
    security.push({ apiKey: [] });
  }

  return {
    name: config.agentName,
    description: config.agentDescription,
    url: config.agentBaseUrl,
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    ...(Object.keys(securitySchemes).length > 0 && { securitySchemes }),
    ...(security.length > 0 && { security }),
    skills: [
      {
        id: "chat",
        name: "Conversational AI",
        description:
          "Send a message to the Genesys Cloud AVA. The AVA processes the message through " +
          "an Architect Bot Flow and returns a response.",
        tags: ["chat", "genesys", "ava", "bot-flow"],
        examples: [
          "What are your business hours?",
          "I need help with my account",
          "Transfer me to a human agent",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  };
}
