import axios from "axios";
import type { GenesysRegion } from "./types.js";
import { REGION_AUTH_URLS } from "./types.js";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class GenesysAuth {
  private cache: TokenCache | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly region: GenesysRegion
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.accessToken;
    }
    return this.fetchToken();
  }

  private async fetchToken(): Promise<string> {
    const authUrl = `${REGION_AUTH_URLS[this.region]}/oauth/token`;
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const response = await axios.post<{ access_token: string; expires_in: number }>(
      authUrl,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    this.cache = {
      accessToken: response.data.access_token,
      expiresAt: Date.now() + (response.data.expires_in - 60) * 1000,
    };

    return this.cache.accessToken;
  }

  clearCache(): void {
    this.cache = null;
  }
}
