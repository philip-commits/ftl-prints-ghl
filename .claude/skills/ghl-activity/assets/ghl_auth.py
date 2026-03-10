#!/usr/bin/env python3
"""
GHL OAuth2 token manager for FTL Prints.

Provides get_access_token() which:
  1. Returns a valid OAuth2 Bearer token, auto-refreshing if expired
  2. Falls back to PIT token from ~/.claude/mcp.json if OAuth not set up

Token file: ~/.config/ftl-prints/ghl_tokens.json
"""

import json
import time
import urllib.request
import urllib.error
from pathlib import Path

TOKEN_FILE = Path("~/.config/ftl-prints/ghl_tokens.json").expanduser()
MCP_CONFIG = Path("~/.claude/mcp.json").expanduser()
REFRESH_URL = "https://services.leadconnectorhq.com/oauth/token"
EXPIRY_BUFFER = 300  # refresh 5 minutes before actual expiry


def _load_tokens():
    """Load stored OAuth tokens. Returns dict or None."""
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _save_tokens(tokens):
    """Write tokens to disk with restrictive permissions."""
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))
    TOKEN_FILE.chmod(0o600)


def _refresh(tokens):
    """Exchange refresh_token for a new access_token. Returns updated tokens dict."""
    body = json.dumps({
        "client_id": tokens["client_id"],
        "client_secret": tokens["client_secret"],
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
    }).encode()
    req = urllib.request.Request(
        REFRESH_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "FTL-Prints-Pipeline/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    tokens["access_token"] = data["access_token"]
    tokens["refresh_token"] = data.get("refresh_token", tokens["refresh_token"])
    tokens["expires_at"] = time.time() + data.get("expires_in", 86400)
    _save_tokens(tokens)
    return tokens


def _load_pit_fallback():
    """Load PIT token from mcp.json as backward-compat fallback."""
    if not MCP_CONFIG.exists():
        return None
    try:
        cfg = json.loads(MCP_CONFIG.read_text())
        token = cfg["mcpServers"]["ghl"]["env"]["GHL_AUTH"]
        if not token.lower().startswith("bearer "):
            token = f"Bearer {token}"
        return token
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def get_access_token():
    """
    Return a valid "Bearer <token>" string.

    Priority:
      1. OAuth2 access_token (auto-refreshed if within 5 min of expiry)
      2. PIT token from ~/.claude/mcp.json (legacy fallback)

    Raises RuntimeError if no auth source is available.
    """
    tokens = _load_tokens()
    if tokens and tokens.get("access_token"):
        # Check if token needs refresh
        expires_at = tokens.get("expires_at", 0)
        if time.time() >= expires_at - EXPIRY_BUFFER:
            try:
                tokens = _refresh(tokens)
            except Exception as e:
                # If refresh fails, try PIT fallback before raising
                pit = _load_pit_fallback()
                if pit:
                    return pit
                raise RuntimeError(f"OAuth refresh failed: {e}. Re-authorize via GHL OAuth setup.")
        return f"Bearer {tokens['access_token']}"

    # No OAuth tokens — try PIT fallback
    pit = _load_pit_fallback()
    if pit:
        return pit

    raise RuntimeError(
        "No GHL auth configured.\n"
        "Add a PIT token to ~/.claude/mcp.json or set up OAuth2 tokens\n"
        "in ~/.config/ftl-prints/ghl_tokens.json"
    )
