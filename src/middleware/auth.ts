import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";
import type { BridgeConfig } from "../types.js";

// Cache the JWKS fetcher per issuer so we don't re-fetch on every request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string) {
  if (!jwksCache.has(issuer)) {
    const jwksUri = new URL("/.well-known/jwks.json", issuer);
    jwksCache.set(issuer, createRemoteJWKSet(jwksUri));
  }
  return jwksCache.get(issuer)!;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unauthorized(res: Response, reason: string): void {
  res.status(401).json({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32001, message: `Unauthorized: ${reason}` },
  });
}

export function createAuthMiddleware(config: BridgeConfig) {
  const { oidcIssuer, oidcAudience, apiKeys } = config;

  // Startup guard: warn loudly if the server is being run with no auth configured
  if (!oidcIssuer && (!apiKeys || apiKeys.length === 0)) {
    console.error(
      "[auth] WARNING: No authentication configured. " +
        "Set OIDC_ISSUER and/or A2A_API_KEYS before exposing this server publicly."
    );
  }

  // Pre-hash stored API keys so the comparison is always constant-time against hashes
  const hashedKeys = new Set((apiKeys ?? []).map((k) => (k.length === 64 ? k : sha256(k))));

  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Public paths — Agent Card and health check must be reachable without auth
    // so that A2A callers can discover the security requirements before authenticating.
    const publicPaths = ["/.well-known/agent.json", "/health"];
    if (publicPaths.includes(req.path)) {
      next();
      return;
    }

    const authHeader = req.headers.authorization ?? "";
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

    // ── 1. OIDC Bearer token ────────────────────────────────────────────────
    if (authHeader.startsWith("Bearer ")) {
      if (!oidcIssuer) {
        unauthorized(res, "Bearer token presented but OIDC_ISSUER is not configured");
        return;
      }

      const token = authHeader.slice(7);
      try {
        const jwks = getJwks(oidcIssuer);
        const { payload } = await jwtVerify(token, jwks, {
          issuer: oidcIssuer,
          ...(oidcAudience ? { audience: oidcAudience } : {}),
        });

        // Attach verified claims to the request for downstream logging
        (req as Request & { auth?: unknown }).auth = {
          method: "oidc",
          subject: payload.sub,
          issuer: payload.iss,
        };
        next();
      } catch (err) {
        unauthorized(res, `Invalid bearer token: ${(err as Error).message}`);
      }
      return;
    }

    // ── 2. API key ──────────────────────────────────────────────────────────
    if (apiKeyHeader) {
      if (hashedKeys.size === 0) {
        unauthorized(res, "API key presented but A2A_API_KEYS is not configured");
        return;
      }

      // Compare against hash to avoid leaking keys in timing side-channels
      const incoming = sha256(apiKeyHeader);
      if (!hashedKeys.has(incoming)) {
        unauthorized(res, "Invalid API key");
        return;
      }

      (req as Request & { auth?: unknown }).auth = { method: "apiKey" };
      next();
      return;
    }

    // ── 3. Nothing provided ─────────────────────────────────────────────────
    res.setHeader(
      "WWW-Authenticate",
      [
        oidcIssuer ? 'Bearer realm="a2a-bridge"' : null,
        hashedKeys.size > 0 ? 'ApiKey realm="a2a-bridge"' : null,
      ]
        .filter(Boolean)
        .join(", ") || 'Bearer realm="a2a-bridge"'
    );
    unauthorized(res, "No credentials provided. Supply an Authorization: Bearer <oidc-token> or x-api-key header.");
  };
}
