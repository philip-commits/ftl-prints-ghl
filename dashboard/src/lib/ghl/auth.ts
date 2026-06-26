import { put, head } from "@vercel/blob";
import { GHL_BASE, USER_AGENT } from "../constants";

const TOKEN_BLOB_KEY = "ghl-tokens.json";
const EXPIRY_BUFFER = 300; // refresh 5 min before expiry

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  client_id: string;
  client_secret: string;
}

async function loadTokensFromBlob(): Promise<TokenData | null> {
  try {
    const blob = await head(TOKEN_BLOB_KEY);
    const resp = await fetch(blob.url);
    return (await resp.json()) as TokenData;
  } catch {
    return null;
  }
}

async function saveTokensToBlob(tokens: TokenData): Promise<void> {
  await put(TOKEN_BLOB_KEY, JSON.stringify(tokens), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function refreshToken(tokens: TokenData): Promise<TokenData> {
  const resp = await fetch(`${GHL_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: tokens.client_id,
      client_secret: tokens.client_secret,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const updated: TokenData = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 86400),
  };
  await saveTokensToBlob(updated);
  return updated;
}

export async function getAccessToken(): Promise<string> {
  // Try OAuth2 tokens from Blob
  let tokens = await loadTokensFromBlob();

  if (tokens?.access_token) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= tokens.expires_at - EXPIRY_BUFFER) {
      try {
        tokens = await refreshToken(tokens);
      } catch (e) {
        // Try PIT fallback
        const pit = process.env.GHL_PIT_TOKEN;
        if (pit) return pit.startsWith("Bearer ") ? pit : `Bearer ${pit}`;
        throw e;
      }
    }
    return `Bearer ${tokens.access_token}`;
  }

  // Try env-based refresh token (first deploy bootstrap)
  const refreshTokenEnv = process.env.GHL_REFRESH_TOKEN;
  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;

  if (refreshTokenEnv && clientId && clientSecret) {
    const bootstrapTokens: TokenData = {
      access_token: "",
      refresh_token: refreshTokenEnv,
      expires_at: 0,
      client_id: clientId,
      client_secret: clientSecret,
    };
    const freshTokens = await refreshToken(bootstrapTokens);
    return `Bearer ${freshTokens.access_token}`;
  }

  // PIT fallback
  const pit = process.env.GHL_PIT_TOKEN;
  if (pit) return pit.startsWith("Bearer ") ? pit : `Bearer ${pit}`;

  throw new Error("No GHL auth configured. Set GHL_REFRESH_TOKEN + GHL_CLIENT_ID + GHL_CLIENT_SECRET env vars.");
}
