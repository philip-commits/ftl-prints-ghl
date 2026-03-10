# Build Prompt: FTL Prints Morning Report Skill

## What You're Building

Create a Claude Code skill called `morning-report` inside a new GitHub repo `philip-commits/ftl-prints-skills`. This skill is a daily operational briefing for Philip Munroe, founder of Fort Lauderdale Screen Printing. When Philip runs `/morning-report` in Claude Code each morning, it pulls live data from his GoHighLevel CRM via MCP tools, presents a structured pipeline overview, and lets him take actions (send emails/texts, move stages, create tasks, flag follow-ups) — all through natural language conversation.

**Distribution model:** Philip clones this repo into his `~/.claude/skills/` directory and runs `git pull` to get updates.

---

## Repo Structure

```
philip-commits/ftl-prints-skills/
├── README.md                          # Setup instructions for Philip
├── morning-report/
│   └── SKILL.md                       # The skill definition
└── (future skills go here as sibling folders)
```

---

## README.md Requirements

The README must include step-by-step setup instructions for a non-technical user:

1. **Install Claude Code** — link to https://code.claude.com
2. **Set up the GHL MCP server** — exact `mcp.json` config Philip needs to add. The GHL MCP uses `mcp-remote` as a stdio bridge to the HTTP endpoint. Here is the exact config:

```json
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
```

3. **CRITICAL: Project cache registration** — After adding the GHL config to `~/.claude/mcp.json`, the entry must ALSO be added to the project's `mcpServers` in `~/.claude.json` under the relevant project key. Claude Code caches MCP server lists per-project and will silently ignore new `mcp.json` entries if they aren't registered in this project cache. This can be done by running a Python script (include the script in the README) or by using `claude mcp add`. Without this step, the GHL MCP will NOT appear in `/mcp` even though the config is correct.

4. **Clone the skills repo:**
```bash
git clone https://github.com/philip-commits/ftl-prints-skills.git ~/.claude/skills/ftl-prints-skills
```

5. **Run it:** Open Claude Code in the project directory and type `/morning-report`

6. **Update:** `cd ~/.claude/skills/ftl-prints-skills && git pull`

---

## SKILL.md Specification

### Skill Metadata

- **Name:** Morning Report
- **Trigger:** `/morning-report`
- **Description:** Daily operational briefing — pipeline status, conversations, tasks, new inbound, aging alerts, and actionable next steps.

### Critical Technical Notes (put these at the top of the SKILL.md)

1. **Use GHL MCP tools directly** — call `mcp__ghl__*` tools as direct tool calls. Do NOT check config files or assume tools aren't available. Just call them.
2. **Pagination** — The GHL search opportunity API returns 20 results by default. ALWAYS pass `query_limit: 100` to get all opportunities. Do not assume the first page is complete.
3. **GHL REST API for tasks** — The GHL MCP does not yet expose task create/update/delete tools. For these operations, use `curl` via Bash with the PIT token from the environment:
   ```bash
   curl -s -X POST 'https://services.leadconnectorhq.com/contacts/{contactId}/tasks' \
     -H 'Authorization: Bearer <PIT_TOKEN>' \
     -H 'Version: 2021-07-28' \
     -H 'Content-Type: application/json' \
     -d '{"title":"...","dueDate":"...","body":"...","completed":false}'
   ```
   Note: The field is `body`, NOT `description` (the API rejects `description`).
   For delete: `curl -s -X DELETE '.../contacts/{contactId}/tasks/{taskId}'`
4. **International phone numbers** — Some contacts have international numbers (Bahamas +1-242, Switzerland +41, Canada +1-514). Calls to these numbers will FAIL due to Twilio country restrictions. Flag these for email-only follow-up.
5. **FILE WRITES:** Before writing to any output file, first check if it exists using bash: `cat /path/to/file.md 2>/dev/null || echo "File does not exist"`. If the file exists, read it with the Read tool before overwriting.

### Pipeline Configuration

```
Pipeline: "New Lead Pipeline"
Pipeline ID: GeLwykvW1Fup6Z5oiKir

Stages (in order):
1. New Lead      — 29fcf7b0-289c-44a4-ad25-1d1a0aea9063
2. In Progress   — 5ee824df-7708-4aba-9177-d5ac02dd6828
3. Quote Sent    — 336a5bee-cad2-400f-83fd-cae1bc837029
4. Invoice Sent  — 259ee5f4-5667-4797-948e-f36ec28c70a0
5. Sale          — 1ab155c2-282d-45eb-bd43-1052489eb2a1
6. Cooled Off    — 7ec748b8-920d-4bdb-bf09-74dd22d27846
7. Unqualified   — b909061c-9141-45d7-b1e2-fd37432c3596

Location ID: iCyLg9rh8NtPpTfFCcGk
```

### Custom Field Mapping

The quote form captures these fields (referenced by ID in opportunity customFields):

```
JHW5PxBCcgu43kKGLMDs — Artwork files (array of file uploads)
JzrbUu1GzN23Zh1DoPWV — Quantity (string)
T3YKV1ASH2yYKnUA4f2U — Project details / notes (string)
TslKUu7r74uPuHcdkYYG — Service type (string: "Screen Printing", "DTF / Heat Transfer", "Embroidery", "Custom Patches", "Finishing", "Not sure (We will recommend)")
Zg16bXIPdxyVDB9fSQQC — Budget range (string: "$0 - $149", "$150 - $499", "$500 - $999", "$1,000+")
fWONzFx0SZrXbK81RgJn — Sizes (string)
```

---

### Report Process (Step by Step)

#### Phase 1: Fetch All Pipeline Data

```
Tool: mcp__ghl__opportunities_search-opportunity
Params:
  - query_pipeline_id: GeLwykvW1Fup6Z5oiKir
  - query_limit: 100
```

Parse the response and group opportunities by stage. For each opportunity, extract:
- Contact name, email, phone
- Service type, quantity, sizes, budget, project details (from customFields mapping above)
- Whether artwork was uploaded
- Source/attribution (Google organic, ChatGPT, Instagram, direct, referral)
- Days since created
- Days in current stage

#### Phase 2: Fetch Conversations for Active Leads

For opportunities in stages: New Lead, In Progress, Quote Sent, Invoice Sent — fetch the conversation:

```
Tool: mcp__ghl__conversations_search-conversation
Params:
  - query_contactId: {contactId}
```

Then get messages:

```
Tool: mcp__ghl__conversations_get-messages
Params:
  - path_conversationId: {conversationId}
  - query_limit: 10
```

Track:
- Last message date, direction (inbound/outbound), and type (email/SMS/call)
- Whether the lead has EVER replied (any inbound message)
- Failed calls (check for error field with "country restrictions")
- Any emails with body "undefined" (broken emails that need to be resent)

#### Phase 3: Identify Blockers Per Opportunity

For each In Progress opportunity, analyze what's missing for a quote to be sent:

| Missing Info | Check |
|---|---|
| No quantity | `JzrbUu1GzN23Zh1DoPWV` field is empty/missing |
| No size breakdown | `fWONzFx0SZrXbK81RgJn` field is vague (e.g., "S/M/L" without per-size counts) |
| No artwork | `JHW5PxBCcgu43kKGLMDs` field is empty/missing |
| Waiting on new artwork | Project details mention "will provide" or "new logo" |
| No project details | `T3YKV1ASH2yYKnUA4f2U` field is empty |
| Print location unknown | Details don't specify front/back/both |
| Shirt/garment color unknown | No color mentioned anywhere |
| Budget mismatch | Budget seems unrealistically low for the quantity/service requested |
| International contact | Phone starts with +41, +44, or +1-242, +1-246, +1-268 (Caribbean) — can't call |
| No response from lead | No inbound messages after initial outreach |
| Broken email sent | Any outbound email with body "undefined" |

#### Phase 4: Generate Aging Alerts

Flag opportunities that are aging out:
- **Red alert (7+ days in stage):** These are going cold. Recommend moving to Cooled Off or one final follow-up.
- **Yellow alert (4-6 days):** Need attention today.
- **Green (0-3 days):** On track.

#### Phase 5: Present the Report

Format the report as a structured morning briefing. Use this layout:

```
## Good morning, Philip! Here's your pipeline for [Today's Date].

### Quick Stats
| Metric | Count |
|--------|-------|
| Total Open Opportunities | X |
| New leads (last 24h) | X |
| Awaiting your reply | X |
| Leads that replied | X |
| Aging alerts (7+ days) | X |

### 🔴 Needs Immediate Action
[Opportunities with aging alerts, broken emails, or inbound replies waiting]

### 📋 In Progress (X) — Blocker Summary
[Table with: Name | Service | Qty | What's Missing | Days in Stage | Source]

For each lead, show:
- What they want (1 sentence)
- What's blocking the quote
- Recommended next action

### 📨 Quote Sent (X) — Awaiting Response
[Leads with quotes out, when quote was sent, any follow-ups done]

### 🧾 Invoice Sent (X) — Awaiting Payment
[Leads with invoices out, when invoice was sent, any follow-ups done]

### ✅ Recent Sales (X)
[Sales from the last 7 days with value if available]

### ❄️ Cooled Off / Unqualified
[Summary counts only, not detailed — e.g., "21 cooled off, 6 unqualified"]

### Suggested Call List
[Ordered list of contacts to call today, with phone number and reason. Exclude international numbers that can't be called — note those separately as email-only.]

### What would you like to do?
[Prompt Philip for action — e.g., "Send an email to...", "Move X to cooled off", "Create a follow-up task for..."]
```

---

### Available Actions (Phase 6: Interactive)

After presenting the report, enter interactive mode. Philip can request any of these actions via natural language:

#### Send Email
```
Tool: mcp__ghl__conversations_send-a-new-message
Params:
  - body_type: "Email"
  - body_contactId: {contactId}
  - body_subject: "..."
  - body_html: "<p>...</p>"
  - body_message: "..." (plain text fallback)
```

Always draft the email and show Philip for approval before sending. Use a professional, friendly tone consistent with FTL Prints brand (casual but competent, South Florida vibe). Sign off as Philip unless he specifies otherwise.

#### Send Text/SMS
```
Tool: mcp__ghl__conversations_send-a-new-message
Params:
  - body_type: "SMS"
  - body_contactId: {contactId}
  - body_message: "..."
```

Keep texts short (<160 chars if possible). Draft and show for approval before sending.

#### Move Pipeline Stage
```
Tool: mcp__ghl__opportunities_update-opportunity
Params:
  - path_id: {opportunityId}
  - body_pipelineStageId: {stageId}
```

Confirm with Philip before moving. Show current stage → new stage.

#### Create Task (via REST API)
```bash
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/{contactId}/tasks' \
  -H 'Authorization: Bearer {PIT_TOKEN}' \
  -H 'Version: 2021-07-28' \
  -H 'Content-Type: application/json' \
  -d '{"title":"...","dueDate":"...","body":"...","completed":false}'
```

Note: Use `body` field, NOT `description`. The API rejects `description`.

#### Update Opportunity Value
```
Tool: mcp__ghl__opportunities_update-opportunity
Params:
  - path_id: {opportunityId}
  - body_monetaryValue: {value}
```

Encourage Philip to add monetary values to opportunities as they become clearer.

#### Add/Remove Tags
```
Tool: mcp__ghl__contacts_add-tags / mcp__ghl__contacts_remove-tags
Params:
  - path_contactId: {contactId}
  - body_tags: ["tag1", "tag2"]
```

---

### Business Context (Include in SKILL.md for AI understanding)

Fort Lauderdale Screen Printing (FTL Prints) is a custom apparel and printing shop in Fort Lauderdale, FL. Services include:
- Screen printing
- DTF / heat transfer printing
- Embroidery
- Custom patches (embroidered, PVC, rubber)
- Finishing (labels, tags, repackaging)

**Key business facts:**
- Founder: Philip Munroe (philip@ftlprints.com)
- Phone: (954) 804-0161
- Website: fortlauderdalescreenprinting.com
- GHL location ID: iCyLg9rh8NtPpTfFCcGk
- Team member Albert also sends follow-up emails
- Typical turnaround: 2-3 weeks for most jobs, 4 weeks for patches
- ChatGPT is a major and growing referral source
- Many leads come from the Bahamas (+1-242 numbers) — calls to these WILL FAIL due to Twilio country restrictions. Use email only.

**Common blockers preventing quotes:**
1. Missing size breakdown (most common — 70%+ of leads)
2. Missing or unclear artwork
3. Missing quantity
4. Vague project details (no print locations, no garment color)
5. Budget expectations too low for the requested service

**Quoting workflow:**
- Lead submits form → auto-email + auto-SMS confirmation → Philip/Albert review → gather missing info → send quote → follow up

---

### Tone & Style

The report should be:
- **Scannable** — Philip should understand his pipeline in 30 seconds
- **Action-oriented** — every lead has a clear "what to do next"
- **No fluff** — skip leads that don't need attention (Cooled Off/Unqualified are summary only)
- **Prioritized** — highest value and most urgent leads first
- **Honest** — flag leads that are likely dead, low-budget mismatches, etc.

When drafting emails/texts for Philip:
- Professional but warm, South Florida casual
- Short and direct
- Always ask for the specific missing info needed
- Sign off as "Philip" or "The FTL Prints Team" depending on context

---

### Error Handling

- If GHL MCP returns 401: Token expired. Tell Philip to generate a new PIT in GHL Settings > Private Integrations and update his `mcp.json`.
- If an opportunity has no conversation: Skip conversation fetch, note "No conversation history" in the report.
- If the API returns fewer results than expected: Note the count and mention pagination may be needed.
- If a tool call fails: Report the error clearly and continue with the rest of the report. Don't halt the entire report for one failed call.

---

## Testing Checklist

After building the skill, verify:

1. [ ] `/morning-report` triggers the skill correctly
2. [ ] All 53+ opportunities are fetched (not just 20)
3. [ ] Opportunities are correctly grouped by stage
4. [ ] Custom fields (service type, quantity, sizes, budget, artwork, notes) are parsed correctly
5. [ ] Conversations are fetched for active leads
6. [ ] Blockers are identified correctly for In Progress leads
7. [ ] Aging alerts fire for leads 4+ and 7+ days in stage
8. [ ] International numbers are flagged
9. [ ] Email sending works via MCP tool (test with a safe contact)
10. [ ] SMS sending works via MCP tool (test with a safe contact)
11. [ ] Stage moves work via MCP tool
12. [ ] Task creation works via REST API curl
13. [ ] Report renders cleanly in the Claude Code terminal
14. [ ] Interactive action mode works after report display
