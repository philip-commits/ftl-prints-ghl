---
name: ghl-activity
description: "Daily CRM activity summary for FTL Prints. Shows today's outbound/inbound messages (manual vs automated), notes created, tasks created, and opportunity stage movements. Read-only activity log. Triggers on: today's activity, activity summary, what happened today, daily activity, crm activity, ghl activity."
---

# Daily Activity Summary

Read-only activity log for Philip Munroe showing everything that happened today in GoHighLevel — messages sent/received, notes created, tasks created, and stage movements.

---

## How to Run

**Step 1: Fetch today's activity data.**

```bash
python3 .claude/skills/ghl-activity/assets/fetch_activity.py
```

This script:
- Fetches all pipeline opportunities via GHL REST API
- For each contact (max 3 concurrent): fetches messages, notes, and tasks
- Filters everything to today (Eastern time — Fort Lauderdale local)
- Classifies messages by channel, direction, and source (manual/automated/api)
- Captures stage change activity messages
- Writes structured JSON to `/tmp/ftl_activity.json`

**On 401 error:** The script prints auth re-setup instructions and exits. Relay to Philip.

**Step 2: Read the output.**

```
Read: /tmp/ftl_activity.json
```

**Step 3: Present the summary using this format:**

---

## Activity Summary — {date}

### Outbound Messages

| Channel | API | Manual | Automated | Total |
|---------|-----|--------|-----------|-------|
| Email   | {n} | {n}    | {n}       | {n}   |
| SMS     | {n} | {n}    | {n}       | {n}   |
| Call    | {n} | {n}    | {n}       | {n}   |
| **Total** | **{n}** | **{n}** | **{n}** | **{n}** |

### Inbound Messages

| Channel | Count |
|---------|-------|
| Email   | {n}   |
| SMS     | {n}   |
| Call    | {n}   |
| **Total** | **{n}** |

### Other Activity

- **Stage changes:** {n}
- **Notes created:** {n}
- **Tasks created:** {n}

---

## Notes

- "Today" is calculated in Eastern time (America/New_York) to match Philip's local day
- Message source classification:
  - **Manual** = sent by a human via the GHL app (source=app or userId present)
  - **Automated** = sent by a workflow (source=workflow)
  - **API** = sent via API integration (source=api) — shown as its own column
- The script reuses OAuth2 auth from the `/ghl` skill (`ghl_auth.py`)
- Per-contact detail is available in `/tmp/ftl_activity.json` if needed
