---
name: ghl
description: "Daily operational briefing for FTL Prints. Pulls live pipeline data from GoHighLevel CRM, presents a structured overview of all opportunities, flags blockers and aging leads, and supports interactive actions (send emails/texts, move stages, create tasks). Triggers on: morning report, daily briefing, pipeline status, what's my pipeline, show me my leads, ghl."
---

# Morning Report

Daily operational briefing for Philip Munroe, founder of Fort Lauderdale Screen Printing. This skill pulls live data from GoHighLevel via MCP tools, presents a structured pipeline overview, and lets Philip take actions through natural language conversation.

---

## Critical Technical Notes

1. **Use GHL MCP tools with curl fallback** — First try `mcp__ghl__opportunities_search-opportunity` directly. If it returns a **401 error**, the MCP remote proxy has an auth issue. Fall back to direct curl using the auto-refreshing token from `ghl_auth.py`:
   ```bash
   GHL_TOKEN=$(python3 -c "import sys; sys.path.insert(0, '.claude/skills/ghl/assets'); from ghl_auth import get_access_token; print(get_access_token())")
   curl -s 'https://services.leadconnectorhq.com/opportunities/search?pipeline_id=GeLwykvW1Fup6Z5oiKir&location_id=iCyLg9rh8NtPpTfFCcGk&limit=100' \
     -H "Authorization: $GHL_TOKEN" \
     -H 'Version: 2021-07-28' \
     -H 'User-Agent: FTL-Prints-Pipeline/1.0'
   ```
   This uses the OAuth2 token (auto-refreshed if expired) with PIT fallback. Save the JSON response to `/tmp/ftl_raw_opps.json` and parse with the Phase 1 python script (adjust to read `data` → `opportunities` directly since the curl response is raw JSON, not wrapped in a temp file array).

   Similarly, for **sending messages** when MCP tools fail with 401, use curl:
   ```bash
   GHL_TOKEN=$(python3 -c "import sys; sys.path.insert(0, '.claude/skills/ghl/assets'); from ghl_auth import get_access_token; print(get_access_token())")
   # Send Email
   curl -s -X POST 'https://services.leadconnectorhq.com/conversations/messages' \
     -H "Authorization: $GHL_TOKEN" \
     -H 'Version: 2021-07-28' \
     -H 'Content-Type: application/json' \
     -d '{"type":"Email","contactId":"...","subject":"...","html":"...","emailFrom":"philip@ftlprints.com"}'

   # Send SMS
   curl -s -X POST 'https://services.leadconnectorhq.com/conversations/messages' \
     -H "Authorization: $GHL_TOKEN" \
     -H 'Version: 2021-07-28' \
     -H 'Content-Type: application/json' \
     -d '{"type":"SMS","contactId":"...","message":"..."}'
   ```

2. **Pagination** — The GHL search opportunity API returns 20 results by default. ALWAYS pass `query_limit: 100` to get all opportunities. Do not assume the first page is complete.

3. **GHL REST API for tasks** — The GHL MCP does not expose task create/update/delete tools. For these operations, use `curl` via Bash with the auto-refreshing token:
   ```bash
   GHL_TOKEN=$(python3 -c "import sys; sys.path.insert(0, '.claude/skills/ghl/assets'); from ghl_auth import get_access_token; print(get_access_token())")
   curl -s -X POST 'https://services.leadconnectorhq.com/contacts/{contactId}/tasks' \
     -H "Authorization: $GHL_TOKEN" \
     -H 'Version: 2021-07-28' \
     -H 'Content-Type: application/json' \
     -d '{"title":"...","dueDate":"...","body":"...","completed":false}'
   ```
   Note: The field is `body`, NOT `description` (the API rejects `description`).
   For delete: `curl -s -X DELETE '.../contacts/{contactId}/tasks/{taskId}'`

4. **International phone numbers** — Some contacts have international numbers (Bahamas +1-242, Switzerland +41, Canada +1-514). Calls to these numbers will FAIL due to Twilio country restrictions. Flag these for email-only follow-up.

5. **File writes** — Before writing to any output file, first check if it exists using bash: `cat /path/to/file.md 2>/dev/null || echo "File does not exist"`. If the file exists, read it with the Read tool before overwriting.

6. **GHL API rate limits** — Never make more than 3 parallel MCP tool calls to GHL. If you get a 503 or 500 error, retry that call once after a 2-second pause (use `sleep 2` via Bash). If it fails again, skip it and note the gap in the report.

7. **Large API responses** — The opportunity search returns ~200K+ characters, which exceeds inline tool result limits. When this happens, the result is automatically saved to a temp file. Use the python3 parsing script in Phase 1 to handle this. The JSON structure in the temp file is:
   ```
   [{"type": "text", "text": "{...}"}]  ← outer array
   → parse [0]["text"] as JSON
   → access .data.opportunities (array of opportunity objects)
   ```

8. **Static assets** — `server.py`, `dashboard.html`, `fetch_convos.py`, `enrich.py`, `ghl_auth.py`, and `ghl_oauth_setup.py` live in `.claude/skills/ghl/assets/`. Do NOT regenerate or overwrite them.

9. **Enrichment script** — `assets/enrich.py` computes `suggestedAction` and derived fields (`isInternational`, `missingInfo`, `needsReply`, etc.). Use its output as the starting point for Phase 3 — override only when conversation context warrants it.

---

## Pipeline Configuration

```
Pipeline: "New Lead Pipeline"
Pipeline ID: GeLwykvW1Fup6Z5oiKir

Stages (in order):
1. New Lead        — 29fcf7b0-289c-44a4-ad25-1d1a0aea9063
2. In Progress     — 5ee824df-7708-4aba-9177-d5ac02dd6828
3. Quote Sent      — 259ee5f4-5667-4797-948e-f36ec28c70a0
4. Needs Attention — accf1eef-aa13-46c3-938d-f3ec6fbe498b
5. Follow Up       — 336a5bee-cad2-400f-83fd-cae1bc837029
6. Sale            — 1ab155c2-282d-45eb-bd43-1052489eb2a1
7. Cooled Off      — 7ec748b8-920d-4bdb-bf09-74dd22d27846
8. Unqualified     — b909061c-9141-45d7-b1e2-fd37432c3596

Location ID: iCyLg9rh8NtPpTfFCcGk
Active Stages (full analysis):
  1. New Lead        — 29fcf7b0-289c-44a4-ad25-1d1a0aea9063
  2. In Progress     — 5ee824df-7708-4aba-9177-d5ac02dd6828
  3. Quote Sent      — 259ee5f4-5667-4797-948e-f36ec28c70a0
  4. Needs Attention — accf1eef-aa13-46c3-938d-f3ec6fbe498b
  5. Follow Up       — 336a5bee-cad2-400f-83fd-cae1bc837029

Inactive Stages (unanswered check only):
  6. Sale            — 1ab155c2-282d-45eb-bd43-1052489eb2a1
  7. Cooled Off      — 7ec748b8-920d-4bdb-bf09-74dd22d27846
  8. Unqualified     — b909061c-9141-45d7-b1e2-fd37432c3596
```

### Custom Field Mapping

The quote form captures these fields (referenced by ID in opportunity `customFields`):

| Field ID | Field |
|----------|-------|
| `JHW5PxBCcgu43kKGLMDs` | Artwork files (array of file uploads) |
| `JzrbUu1GzN23Zh1DoPWV` | Quantity (string) |
| `T3YKV1ASH2yYKnUA4f2U` | Project details / notes (string) |
| `TslKUu7r74uPuHcdkYYG` | Service type (string: "Screen Printing", "DTF / Heat Transfer", "Embroidery", "Custom Patches", "Finishing", "Not sure") |
| `Zg16bXIPdxyVDB9fSQQC` | Budget range (string: "$0 - $149", "$150 - $499", "$500 - $999", "$1,000+") |
| `fWONzFx0SZrXbK81RgJn` | Sizes (string) |

**Accessing custom field values:** Each item in an opportunity's `customFields` array has:
- `id` — the field ID from the table above
- `fieldValueString` — for string fields (quantity, sizes, budget, service type, project details)
- `fieldValueFiles` — for file array fields (artwork). Each file has `url`, `meta.name`, `meta.size`.
Do NOT look for `fieldValue` or `value` — those keys don't exist.

---

## Report Process

### Phase 1: Fetch All Pipeline Data

**Step 1a: Try MCP first, fall back to curl on 401.**

```
Tool: mcp__ghl__opportunities_search-opportunity
Params:
  - query_pipeline_id: GeLwykvW1Fup6Z5oiKir
  - query_limit: 100
```

If MCP returns **401**, fall back to curl:
```bash
GHL_TOKEN=$(python3 -c "import sys; sys.path.insert(0, '.claude/skills/ghl/assets'); from ghl_auth import get_access_token; print(get_access_token())")
curl -s "https://services.leadconnectorhq.com/opportunities/search?pipeline_id=GeLwykvW1Fup6Z5oiKir&location_id=iCyLg9rh8NtPpTfFCcGk&limit=100" \
  -H "Authorization: $GHL_TOKEN" \
  -H 'Version: 2021-07-28' \
  -H 'User-Agent: FTL-Prints-Pipeline/1.0' | python3 -c "
import json, sys
data = json.load(sys.stdin)
with open('/tmp/ftl_raw_opps.json', 'w') as f:
    json.dump(data, f)
print(f'Fetched {len(data.get(\"opportunities\", []))} opportunities via curl fallback')
"
```

**Step 1b: Parse the data.** The MCP response will be saved to a temp file (wrapped in a `[{"type":"text","text":"..."}]` array). The curl fallback saves raw JSON to `/tmp/ftl_raw_opps.json`. The parsing script handles both formats:

```bash
python3 << 'PYEOF'
import json, sys, os
from datetime import datetime, timezone

# --- Load the data ---
# Search multiple locations where Claude may save large tool results
temp_file = None
search_dirs = ["/tmp"]
# Also search Claude project tool-results directories
claude_base = os.path.expanduser("~/.claude/projects")
if os.path.isdir(claude_base):
    for root, dirs, files in os.walk(claude_base):
        if os.path.basename(root) == "tool-results":
            search_dirs.append(root)

for d in search_dirs:
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d), reverse=True):
        if "opportunities" in f.lower() or (f.startswith("mcp_tool_result_") and f.endswith(".json")):
            candidate = os.path.join(d, f)
            # Use the most recently modified matching file
            if temp_file is None or os.path.getmtime(candidate) > os.path.getmtime(temp_file):
                temp_file = candidate

# First check for curl fallback file (raw JSON from direct API call)
curl_file = "/tmp/ftl_raw_opps.json"
if os.path.exists(curl_file) and (temp_file is None or os.path.getmtime(curl_file) > os.path.getmtime(temp_file)):
    with open(curl_file) as fh:
        inner = json.load(fh)
    print(f"Loaded data from curl fallback: {curl_file}")
elif temp_file and os.path.exists(temp_file):
    with open(temp_file) as fh:
        raw = json.load(fh)
    # Temp file structure: [{"type":"text","text":"{...}"}]
    inner = json.loads(raw[0]["text"])
    print(f"Loaded data from MCP temp file: {temp_file}")
else:
    print("ERROR: No data file found. Check tool result for inline data.", file=sys.stderr)
    sys.exit(1)

# Handle both formats: curl returns {opportunities:[...]}, MCP returns {data:{opportunities:[...]}}
opportunities = inner.get("opportunities") or inner.get("data", {}).get("opportunities", [])
print(f"Total opportunities: {len(opportunities)}")

# --- Stage definitions ---
ACTIVE_STAGES = {
    "29fcf7b0-289c-44a4-ad25-1d1a0aea9063": "New Lead",
    "5ee824df-7708-4aba-9177-d5ac02dd6828": "In Progress",
    "259ee5f4-5667-4797-948e-f36ec28c70a0": "Quote Sent",
    "accf1eef-aa13-46c3-938d-f3ec6fbe498b": "Needs Attention",
    "336a5bee-cad2-400f-83fd-cae1bc837029": "Follow Up",
}
INACTIVE_STAGES = {
    "1ab155c2-282d-45eb-bd43-1052489eb2a1": "Sale",
    "7ec748b8-920d-4bdb-bf09-74dd22d27846": "Cooled Off",
    "b909061c-9141-45d7-b1e2-fd37432c3596": "Unqualified",
}

# --- Custom field IDs ---
CF = {
    "JHW5PxBCcgu43kKGLMDs": "artwork",
    "JzrbUu1GzN23Zh1DoPWV": "quantity",
    "T3YKV1ASH2yYKnUA4f2U": "project_details",
    "TslKUu7r74uPuHcdkYYG": "service_type",
    "Zg16bXIPdxyVDB9fSQQC": "budget",
    "fWONzFx0SZrXbK81RgJn": "sizes",
}

now = datetime.now(timezone.utc)
active = []
inactive_summary = {}
inactive_contacts = []

for opp in opportunities:
    stage_id = opp.get("pipelineStageId", "")
    contact = opp.get("contact", {})
    created = opp.get("createdAt", "")
    stage_changed = opp.get("lastStageChangeAt") or opp.get("lastStatusChangeAt") or created

    # Parse dates
    days_created = 0
    days_in_stage = 0
    try:
        dt_created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        days_created = (now - dt_created).days
    except: pass
    try:
        dt_stage = datetime.fromisoformat(stage_changed.replace("Z", "+00:00"))
        days_in_stage = (now - dt_stage).days
    except: pass

    # Extract custom fields
    cfields = {}
    for cf in opp.get("customFields", []):
        cf_id = cf.get("id", "")
        if cf_id in CF:
            name = CF[cf_id]
            if name == "artwork":
                files = cf.get("fieldValueFiles", [])
                cfields[name] = [f.get("url", "") for f in files] if files else []
            else:
                cfields[name] = cf.get("fieldValueString", "")

    if stage_id in ACTIVE_STAGES:
        active.append({
            "id": opp.get("id"),
            "name": contact.get("name", "Unknown"),
            "email": contact.get("email", ""),
            "phone": contact.get("phone", ""),
            "contactId": contact.get("id", ""),
            "stage": ACTIVE_STAGES[stage_id],
            "stageId": stage_id,
            "source": opp.get("source", ""),
            "monetaryValue": opp.get("monetaryValue", 0),
            "days_created": days_created,
            "days_in_stage": days_in_stage,
            **cfields,
        })
    elif stage_id in INACTIVE_STAGES:
        stage_name = INACTIVE_STAGES[stage_id]
        inactive_summary[stage_name] = inactive_summary.get(stage_name, 0) + 1
        inactive_contacts.append({
            "id": opp.get("id"),
            "name": contact.get("name", "Unknown"),
            "contactId": contact.get("id", ""),
            "stage": stage_name,
        })

# --- Write output ---
output = {
    "active": active,
    "inactive_summary": inactive_summary,
    "inactive_contacts": inactive_contacts,
}
with open("/tmp/ftl_pipeline.json", "w") as fh:
    json.dump(output, fh, indent=2)

# Print summary to stdout
print(f"\nActive opportunities: {len(active)}")
for stage_name in ["New Lead", "In Progress", "Quote Sent", "Needs Attention", "Follow Up"]:
    count = sum(1 for o in active if o["stage"] == stage_name)
    if count: print(f"  {stage_name}: {count}")
print(f"\nInactive opportunities: {sum(inactive_summary.values())}")
for stage_name, count in inactive_summary.items():
    print(f"  {stage_name}: {count}")
print(f"\nFull data written to /tmp/ftl_pipeline.json")
PYEOF
```

After the script runs, read `/tmp/ftl_pipeline.json` with the Read tool to get the structured data for all subsequent phases.

### Phase 2: Fetch Conversations

Run the conversation fetch script to collect metadata for all active leads:

```bash
python3 .claude/skills/ghl/assets/fetch_convos.py
```

This script reads `/tmp/ftl_pipeline.json`, fetches conversation metadata, contact notes, and recent message bodies for each active lead via the GHL REST API (max 3 concurrent, with retry), and writes `/tmp/ftl_convos.json`. Each non-"New Lead" contact entry includes a `notes` array (all notes, newest first) with `body` and `dateAdded`, plus a `messages` array (up to 20 most recent messages, newest first) with `direction`, `channel`, `body` (plain text, max 500 chars), and `date`.

**On 401 error:** The script prints instructions to run `ghl_oauth_setup.py` or update the PIT token. Stop the report and relay this to Philip.

**On other failures:** Proceed to Phase 2.5 anyway — the enrichment script gracefully degrades without conversation data.

### Phase 2.5: Enrich Pipeline Data

Run the enrichment script to compute derived fields and suggested actions for each lead:

```bash
python3 .claude/skills/ghl/assets/enrich.py
```

Then read the output:

```
Read: /tmp/ftl_enriched.json
```

The enriched data adds these fields to each lead:
- `isInternational` — whether the phone number is international (calls will fail)
- `missingInfo` — array of missing custom fields: artwork, sizes, quantity, project_details
- `waitingOnArtwork`, `hasArtwork`, `hasQuantity`, `hasSizes`, `hasProjectDetails` — boolean flags
- `needsReply` — unread inbound message waiting
- `hasManualOutreach` — whether a human (not automation) has reached out
- `daysSinceLastContact` — days since most recent message
- `noConversation` — no conversation history found
- `notes` — all contact notes (each with `body` and `dateAdded`), newest first. Claude reads these to inform action decisions; the dashboard shows them in a collapsible section
- `conversationHistory` — up to 20 most recent messages (newest first), each with `direction` (inbound/outbound), `channel` (email/sms/call), `body` (plain text, HTML stripped, max 500 chars), and `date`. Use to understand what was actually discussed — not just when/how, but what
- `suggestedAction` — one of: reply, outreach, call, follow_up_email, move, none
- `suggestedPriority` — high, medium, info, or none
- `hint` — human-readable reason for the suggestion

### Phase 3: Generate Action Items

The enrichment script (Phase 2.5) has already computed `suggestedAction`, `suggestedPriority`, and `hint` for each lead. Use the enriched data from `/tmp/ftl_enriched.json` as your starting point.

**For each lead in `leads`:**
1. Review `suggestedAction` and `hint` — these are the script's recommendation based on conversation state, stage age, and phone type
2. Override if conversation context warrants it (e.g., lead said "back next week", project is out of scope, lead explicitly declined)
3. Map to dashboard action format: reply, outreach, call, follow_up_email, move, or none
4. Use `missingInfo`, `isInternational`, `hasArtwork`, etc. directly — do NOT re-derive these from raw custom fields
5. **Read conversation history AND notes carefully** — two data sources inform context:

   **`conversationHistory`** (up to 20 recent messages with actual text):
   - Read the message bodies to understand what was actually discussed — what the customer asked for, what was quoted, what questions are unanswered
   - Write `context` strings that reference specific things: "Quoted $38.75/unit for 250 PVC patches on Nike Vertical Polo (Feb 19). She needs 250-400 pending head count. Replied Feb 26 — checking with team." instead of "2 days no response — follow up"
   - Always include: quoted prices, product specs (brand, size, service type), quantities, turnaround commitments, what the customer last said, and what's still pending
   - Flag unanswered questions from either side (customer asked something we didn't answer, or we asked for info they haven't provided)
   - Keep `context` under ~250 chars but pack it with the most relevant specifics from the conversation
   - Always include the FULL `conversationHistory` array from enrichment in each action object — do not trim, filter, or curate it. The dashboard shows it in an expandable "Recent messages" section
   - Write a short `recommendation` string (under ~150 chars) — the specific next step Philip should take for this lead. This should be actionable and concrete, e.g. "Call to discuss sizing, then send quote" or "Send follow-up email asking for artwork files". Base it on conversation history, notes, enrichment data, stage, and hint. The dashboard renders this below the Summary line.

   **`notes`** (Philip/Albert's internal notes, newest first):
   - Whether to override `suggestedAction` (e.g., note says "waiting on artwork from designer" → don't nag about artwork)
   - Message tone and content (e.g., note says "spoke on phone, wants quote by Friday" → reference the conversation)
   - Whether a lead is actually dead (e.g., note says "not interested, wrong service" → move to Unqualified instead of Cooled Off)
   - If notes contain useful status info beyond what's in the messages, append a short "Note: ..." phrase to `context`
   - Include the `notes` array in each action object so the dashboard shows them as collapsible "Prior notes" for Philip's reference

For each action, draft a message following these rules:

**Call workflow:**
For domestic contacts with 1+ day no response, the dashboard shows a call card:
1. Phone number (clickable tel: link) + "I Called" button
2. After clicking: "Answered" or "No Answer" options
3. **Answered** → text box to add a note to the contact (saved via `POST /contacts/{contactId}/notes`)
4. **No Answer** → pre-written SMS + email appear, both editable with separate Send buttons

Pre-write both a "tried calling" SMS and email for each call action:
- SMS: Under 160 chars, casual. "Hey [name], tried calling about your [project]. Any questions? —Phil"
- Email: Subject references the call attempt. Body: 3-4 sentences, mention tried calling, reference their project, ask if they have questions.

**Email drafting rules:**
- All emails are editable — pre-write the draft but Phil can modify before sending
- Professional but warm, South Florida casual tone
- 3–5 sentences max
- **Ground every email in the conversation history.** Read the full `conversationHistory` and `notes` before drafting. Reference concrete details from what was actually discussed:
  - Specific prices/quotes already sent (e.g., "$38.75/unit for 250 patches")
  - Mockups, artwork, or attachments that were shared
  - Turnaround times or deadlines mentioned (e.g., "4-5 weeks from approval")
  - What the customer last said they'd do (e.g., "you mentioned checking with your team")
  - Product specifics: garment brand/model, patch size, print locations, colors
  - Previous outreach attempts and outcomes (e.g., "tried calling last Monday")
  - Unanswered questions from either side
- Ask for exactly what's missing — don't be vague
- **Never offer to adjust, reduce, or discount pricing** — Philip decides pricing at his discretion. Reference the quoted price as a fact, don't suggest it's negotiable
- Never write a generic "just checking in" email. Every follow-up must callback at least one specific detail from the conversation so the customer knows you remember their project
- Sign off as "Philip" or "Phil" (or "The FTL Prints Team" for first contact)
- Subject line: short, specific, references their project or the last topic discussed

**SMS drafting rules:**
- Under 160 characters
- Very casual, friendly
- Only for follow-ups, not initial outreach
- **Must reference a specific detail from the conversation** — a quoted price, a product, a mockup, something they asked about. Never just "checking in on your order"
- **Never offer to adjust, reduce, or discount pricing** — that's Philip's decision to make manually
- Example: "Hey Carly, any update from your team on the PVC patch quote? Let me know if you have any questions. —Phil"

**Message decision tree:**
- Lead replied with a question → answer it + ask for next needed info
- Lead hasn't replied 1+ day (domestic) → call them
- Lead hasn't replied 1+ day (international) → follow-up email
- New lead, auto-msgs only → personalized welcome acknowledging their project + ask for missing info
- Quote sent, no reply 3d+ → "wanted to make sure you received the quote"
- Missing artwork → ask for artwork files specifically
- Missing sizes → ask for per-size breakdown (S/M/L/XL with quantities)
- Missing quantity → ask how many total
- International contact → email only, note that SMS/call won't work

**Output:** Write all actions to `/tmp/ftl_actions.json` using the Write tool:

```json
{
  "actions": [
    {
      "id": 1,
      "priority": "high",
      "actionType": "reply",
      "label": "Reply with invoice + minimum order info",
      "contactId": "xxx",
      "contactName": "Ian Hurd",
      "contactCompany": "iSolve",
      "contactEmail": "ihurd@isolve.com",
      "contactPhone": "(508) 308-0059",
      "opportunityId": "xxx",
      "stage": "Follow Up",
      "context": "Replied asking for invoice + minimum qty. Wants 50 black tees with white logo for company event.",
      "recommendation": "Reply with invoice and confirm minimum order is 24 pieces.",
      "conversationHistory": [
        {"direction": "inbound", "channel": "email", "body": "Hi, can you send me an invoice for 50 black tees with our white logo? Also what's your minimum order?", "date": "2026-02-27T10:15:00Z"},
        {"direction": "outbound", "channel": "email", "body": "Hey Ian, thanks for reaching out! We'd be happy to help...", "date": "2026-02-25T14:00:00Z"}
      ],
      "notes": [{"body": "Customer wants 50 black tees with white logo", "dateAdded": "2026-02-20T14:30:00Z"}],
      "messageType": "Email",
      "subject": "Invoice + Order Details — FTL Prints",
      "message": "Hey Ian,\n\nThanks for getting back to me!...",
      "international": false
    },
    {
      "id": 2,
      "priority": "high",
      "actionType": "call",
      "label": "Call — 2 days no response",
      "contactId": "xxx",
      "contactName": "Mike Torres",
      "contactCompany": "Sunset Events",
      "contactEmail": "mike@sunsetevents.com",
      "contactPhone": "(954) 555-0123",
      "opportunityId": "xxx",
      "stage": "In Progress",
      "context": "Last outbound email 2 days ago, no response. Domestic number — call.",
      "recommendation": "Call to check in on screen printing order, follow up with SMS/email if no answer.",
      "messageType": "Call",
      "noAnswerSms": "Hey Mike, tried calling about your screen printing order. Any questions? —Phil",
      "noAnswerSubject": "Tried Calling — Your Screen Printing Order",
      "noAnswerEmail": "Hey Mike,\n\nJust tried giving you a call about your screen printing project. Wanted to see if you had any questions about the sizes or artwork.\n\nFeel free to call me back at (954) 804-0161 or just reply here.\n\nPhilip",
      "international": false
    },
    {
      "id": 3,
      "priority": "info",
      "actionType": "move",
      "label": "Move to Cooled Off — 12 days, no response",
      "contactId": "xxx",
      "contactName": "John Doe",
      "opportunityId": "xxx",
      "stage": "Follow Up",
      "context": "No response after 12 days and 2 follow-ups.",
      "recommendation": "Move to Cooled Off — no engagement after multiple attempts.",
      "targetStageId": "7ec748b8-920d-4bdb-bf09-74dd22d27846",
      "messageType": null,
      "international": false
    }
  ],
  "noAction": [
    {
      "contactName": "Jane Smith",
      "stage": "In Progress",
      "reason": "Contacted today, waiting for their response"
    }
  ],
  "inactiveSummary": {
    "Sale": 9,
    "Cooled Off": 21,
    "Unqualified": 7
  }
}
```

Note: With the 1-day follow-up threshold, the `noAction` array will typically be empty or only contain leads who were contacted today. Every lead with 1+ day of silence gets an action.

Action IDs must be sequential integers starting at 1. Every active lead must appear in either `actions` or `noAction` — no leads silently dropped.

**Categorization rule:** A lead goes into `noAction` ONLY if its `suggestedAction` is `"none"` (after cooldown). ALL other `suggestedAction` values — including `"move"`, `"reply"`, `"outreach"`, `"call"`, `"follow_up_email"`, `"final_attempt_email"`, `"high_value_followup"` — MUST go into `actions`, regardless of priority level. A `"move"` action with `priority: "info"` is still an action that requires Philip's confirmation, not "no action needed".

### Phase 4: Launch Dashboard

The server and HTML dashboard are **static assets** in `.claude/skills/ghl/assets/`. Do NOT write or regenerate `server.py` or `dashboard.html`. The dashboard fetches action data dynamically from `GET /api/actions` which serves `/tmp/ftl_actions.json`.

**Launch steps:**

1. Remove stale sent state so buttons reset:
```bash
rm -f /tmp/ftl_sent.json
```

2. Launch via Claude Preview (opens in the Preview panel, not a separate browser window):
```
Tool: mcp__Claude_Preview__preview_start
Params:
  - name: ghl-dashboard
```

This reads the `ghl-dashboard` configuration from `.claude/launch.json` and starts the server on port 8787 in the Preview panel. If the server is already running, it reuses the existing instance.

**Fallback:** If `preview_start` is unavailable (e.g., no Preview MCP), fall back to manual launch:
```bash
lsof -ti:8787 | xargs kill 2>/dev/null || true
python3 .claude/skills/ghl/assets/server.py &
sleep 1
open http://localhost:8787
```

After launching, print a terminal TL;DR summary:

```
Action dashboard opened in Preview panel.

X actions ready — Y high priority.

Replies: {count}
• Reply to {name} — {label}

New Leads: {count}
• Outreach to {name} — {label}

Calls: {count}
• Call {name} — {label}

Follow-ups: {count}
• Email {name} — {label}

Stage Moves: {count}
• Move {name} to Cooled Off

Review and send directly from the browser.
```

---

## Available Actions

Most actions now happen from the **browser dashboard** (send emails, send SMS, move pipeline stages). The dashboard IS the draft/approval step — Phil reviews the pre-written message and clicks Send.

### Browser Actions (via local server)

These are handled by clicking buttons in the HTML dashboard:
- **Send Email** — calls `POST /api/send/<id>` with subject/message/html in request body → GHL `POST /conversations/messages` with type Email
- **Send SMS** — calls `POST /api/send/<id>_sms` with message in request body → GHL `POST /conversations/messages` with type SMS
- **Save Note** (call answered) — calls `POST /api/note/<id>` with note body → GHL `POST /contacts/{contactId}/notes`
- **Send SMS from Call** (no answer) — calls `POST /api/send/<id>_sms` → GHL `POST /conversations/messages` with type SMS
- **Send Email from Call** (no answer) — calls `POST /api/send/<id>_email` → GHL `POST /conversations/messages` with type Email
- **Move Pipeline Stage** — calls `POST /api/move/<id>` → GHL `PUT /opportunities/<oppId>`

### Terminal Actions (still via conversation)

These still require Claude Code interaction after the dashboard opens:

#### Create Task (via REST API)

```bash
GHL_TOKEN=$(python3 -c "import sys; sys.path.insert(0, '.claude/skills/ghl/assets'); from ghl_auth import get_access_token; print(get_access_token())")
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/{contactId}/tasks' \
  -H "Authorization: $GHL_TOKEN" \
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

#### Add / Remove Tags

```
Tool: mcp__ghl__contacts_add-tags / mcp__ghl__contacts_remove-tags
Params:
  - path_contactId: {contactId}
  - body_tags: ["tag1", "tag2"]
```

#### Deep-Dive Conversation History (On-Demand Only)

Only use `get-messages` when Philip asks about a specific contact's conversation (e.g., "What did we say to X?" or "Check if we sent a broken email to Y"). Do NOT use this during the standard report flow.

```
Tool: mcp__ghl__conversations_get-messages
Params:
  - path_conversationId: {conversationId}
  - query_limit: 20
```

This can detect broken emails (body "undefined"), full reply history, and failed call details.

---

## Business Context

Fort Lauderdale Screen Printing (FTL Prints) is a custom apparel and printing shop in Fort Lauderdale, FL.

**Services:**
- Screen printing
- DTF / heat transfer printing
- Embroidery
- Custom patches (embroidered, PVC, rubber)
- Finishing (labels, tags, repackaging)

**Key facts:**
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
Lead submits form → auto-email + auto-SMS confirmation → Philip/Albert review → gather missing info → send quote → follow up

---

## Tone & Style

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

## Error Handling

- **401 from GHL:** Token expired. If OAuth is set up, run `python3 .claude/skills/ghl/assets/ghl_oauth_setup.py <client_id> <client_secret>` to re-authorize. Otherwise, generate a new PIT in GHL Settings > Private Integrations and update `mcp.json`.
- **No conversation found:** Skip conversation fetch, note "No conversation history" in the report.
- **Fewer results than expected:** Note the count and mention pagination may be needed.
- **Tool call failure:** Report the error clearly and continue with the rest of the report. Don't halt the entire report for one failed call.
- **503 from GHL (rate limit):** Too many parallel API calls. Reduce to 1-at-a-time and retry after 2 seconds.
- **500 ECONNRESET:** Transient network error. Retry once. If it fails again, skip and note the gap.
- **Tool result saved to temp file:** Large response. Use the python3 parsing script from Phase 1.
- **Contact data mismatch:** Contact names in GHL may not match email domains (e.g., contact "Sabrina Thind" with email clark@clarkroofingflorida.com). Report both name and email to avoid confusion.
- **Port 8787 in use:** `preview_start` handles this automatically (reuses running server). If using manual fallback, kill with `lsof -ti:8787 | xargs kill` and retry.
- **Server won't start:** Fall back to a terminal-based action list. Print numbered actions and let Philip say "send 1,3,5" to trigger sends via MCP tool calls directly.
- **GHL API error on send:** The server returns error JSON to the browser. The button shows "Failed — retry" with the error message in a tooltip. Philip can click to retry.
- **Token expired during send:** Server returns 401. OAuth tokens auto-refresh, so this likely means the refresh token expired. Run `ghl_oauth_setup.py` to re-authorize, or update the PIT token in `mcp.json`.
- **Static assets** — `server.py`, `dashboard.html`, `fetch_convos.py`, and `enrich.py` live in `.claude/skills/ghl/assets/`. Do NOT regenerate or overwrite them. The dashboard fetches data dynamically from `/api/actions`.
