# FTL Prints Skills

Claude Code skills for Fort Lauderdale Screen Printing operations.

## Setup

### 1. Install Claude Code

Download and install from [code.claude.com](https://code.claude.com).

### 2. Set Up GHL Authentication

Authentication is handled via OAuth2 tokens stored in `~/.config/ftl-prints/ghl_tokens.json`, with a fallback to PIT tokens in `~/.claude/mcp.json`.

### 3. GHL MCP Server (Optional — Best-Effort)

The MCP server provides Claude Code tool access to GHL. It uses a PIT token which requires manual rotation. The system falls back to direct API calls with OAuth2 when MCP returns 401.

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "ghl": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://services.leadconnectorhq.com/mcp/",
        "--header",
        "Authorization:${GHL_AUTH}",
        "--header",
        "locationId:${GHL_LOCATION}",
        "--transport",
        "http-only"
      ],
      "env": {
        "GHL_AUTH": "Bearer <YOUR_PIT_TOKEN_HERE>",
        "GHL_LOCATION": "<YOUR_LOCATION_ID_HERE>"
      }
    }
  }
}
```

Replace:
- `<YOUR_PIT_TOKEN_HERE>` with your GHL Private Integration Token (Settings > Private Integrations)
- `<YOUR_LOCATION_ID_HERE>` with your GHL Location ID

### 4. Run It

Open Claude Code in your project directory and type:

```
/morning-report
```

## Available Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| Morning Report | `/morning-report` | Daily pipeline briefing with CRM actions |
| Activity Summary | `/ghl-activity` | Daily CRM activity summary |
