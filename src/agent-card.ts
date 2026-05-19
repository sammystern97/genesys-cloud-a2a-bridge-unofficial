import type { AgentCard, BridgeConfig } from "./types.js";

export function buildAgentCard(config: BridgeConfig): AgentCard {
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
    skills: [
      {
        id: "chat",
        name: "Conversational AI",
        description:
          "Send a message to the Genesys Cloud AVA. The AVA processes the message through an Architect Bot Flow and returns a response.",
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
