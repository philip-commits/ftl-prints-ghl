#!/usr/bin/env python3
"""
Fetch today's CRM activity from GoHighLevel for FTL Prints.

Fetches messages, notes, tasks, and stage changes for all pipeline contacts,
filters to today (Eastern time), and writes a structured summary.

Reads auth from: ghl_auth.get_access_token() (OAuth2 with PIT fallback)
Writes: /tmp/ftl_activity.json

Usage:
  python3 .claude/skills/ghl-activity/assets/fetch_activity.py
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

# Import ghl_auth from sibling skill
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "../../ghl/assets"))
from ghl_auth import get_access_token

# --- Config ---
GHL_BASE = "https://services.leadconnectorhq.com"
LOCATION_ID = "iCyLg9rh8NtPpTfFCcGk"
PIPELINE_ID = "GeLwykvW1Fup6Z5oiKir"
OUTPUT_FILE = "/tmp/ftl_activity.json"
MAX_WORKERS = 3
UA = "FTL-Prints-Pipeline/1.0"

# Stage ID → name mapping
STAGES = {
    "29fcf7b0-289c-44a4-ad25-1d1a0aea9063": "New Lead",
    "5ee824df-7708-4aba-9177-d5ac02dd6828": "In Progress",
    "259ee5f4-5667-4797-948e-f36ec28c70a0": "Quote Sent",
    "accf1eef-aa13-46c3-938d-f3ec6fbe498b": "Needs Attention",
    "336a5bee-cad2-400f-83fd-cae1bc837029": "Follow Up",
    "1ab155c2-282d-45eb-bd43-1052489eb2a1": "Sale",
    "7ec748b8-920d-4bdb-bf09-74dd22d27846": "Cooled Off",
    "b909061c-9141-45d7-b1e2-fd37432c3596": "Unqualified",
}


def get_today_range_et():
    """Return (start_of_today, end_of_today) as UTC datetimes using Eastern time boundary."""
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except ImportError:
        # Python < 3.9 fallback: EST = UTC-5 (close enough for day boundary)
        et = timezone(timedelta(hours=-5))

    now_et = datetime.now(et)
    start_et = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    end_et = start_et + timedelta(days=1)
    # Convert to UTC for comparison
    start_utc = start_et.astimezone(timezone.utc)
    end_utc = end_et.astimezone(timezone.utc)
    return start_utc, end_utc, now_et.strftime("%Y-%m-%d")


def parse_timestamp(ts):
    """Parse GHL timestamp (ISO string or epoch millis) → UTC datetime or None."""
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, TypeError, OSError):
        return None


def is_today(ts, start_utc, end_utc):
    """Check if a timestamp falls within today (Eastern time)."""
    dt = parse_timestamp(ts)
    if dt is None:
        return False
    return start_utc <= dt < end_utc


def ghl_request(url, auth, method="GET"):
    """Make an authenticated GHL API request with retry on 500/503."""
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": UA,
    }, method=method)

    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read()), resp.status
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("ERROR: 401 Unauthorized from GHL API.", file=sys.stderr)
                print("Token expired or invalid. To fix:", file=sys.stderr)
                print("  python3 .claude/skills/ghl/assets/ghl_oauth_setup.py <client_id> <client_secret>",
                      file=sys.stderr)
                print("Or update the PIT token in ~/.claude/mcp.json", file=sys.stderr)
                sys.exit(1)
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return None, e.code
        except Exception as e:
            if attempt == 0:
                time.sleep(2)
                continue
            print(f"  WARNING: {e}", file=sys.stderr)
            return None, 0


def fetch_opportunities(auth):
    """Fetch all pipeline opportunities."""
    url = (f"{GHL_BASE}/opportunities/search"
           f"?pipeline_id={PIPELINE_ID}&location_id={LOCATION_ID}&limit=100")
    data, status = ghl_request(url, auth)
    if data is None:
        print(f"ERROR: Failed to fetch opportunities (HTTP {status})", file=sys.stderr)
        sys.exit(1)
    return data.get("opportunities", [])


def get_message_direction(msg):
    """Extract direction from a GHL message (handles email nested direction)."""
    d = msg.get("direction")
    if d:
        return d
    meta = msg.get("meta")
    if isinstance(meta, dict):
        for v in meta.values():
            if isinstance(v, dict) and "direction" in v:
                return v["direction"]
    return None


def classify_message_source(msg):
    """Classify message as 'manual', 'automated', or 'api'."""
    source = (msg.get("source") or "").lower()
    if source == "workflow":
        return "automated"
    if source == "api":
        return "api"
    if source in ("app", "ui"):
        return "manual"
    # If userId is present, a human sent it
    if msg.get("userId"):
        return "manual"
    return "automated"


def get_message_channel(msg):
    """Map messageType to a channel name."""
    mt = (msg.get("messageType") or msg.get("type") or "").upper()
    if "EMAIL" in mt:
        return "email"
    if "SMS" in mt or "TEXT" in mt:
        return "sms"
    if "CALL" in mt:
        return "call"
    if "FB" in mt or "FACEBOOK" in mt:
        return "facebook"
    if "IG" in mt or "INSTAGRAM" in mt:
        return "instagram"
    if "LIVE_CHAT" in mt or "WEBCHAT" in mt:
        return "live_chat"
    return "other"


def fetch_contact_activity(contact_id, contact_name, stage, auth, start_utc, end_utc):
    """Fetch all today's activity for a single contact. Returns activity dict or None."""
    activity = {
        "contactId": contact_id,
        "contactName": contact_name,
        "stage": stage,
        "messages": [],
        "notes": [],
        "tasks": [],
        "stageChanges": [],
    }

    # 1. Find conversation
    url = (f"{GHL_BASE}/conversations/search"
           f"?contactId={contact_id}&locationId={LOCATION_ID}")
    data, status = ghl_request(url, auth)
    conversations = (data or {}).get("conversations", [])

    if conversations:
        convo_id = conversations[0].get("id")
        if convo_id:
            # 2. Fetch messages
            msg_url = f"{GHL_BASE}/conversations/{convo_id}/messages?limit=100"
            msg_data, _ = ghl_request(msg_url, auth)
            if msg_data:
                raw = msg_data.get("messages", msg_data.get("data", []))
                if isinstance(raw, dict):
                    messages = raw.get("messages", [])
                else:
                    messages = raw

                for msg in messages:
                    ts = msg.get("dateAdded") or msg.get("createdAt")
                    if not is_today(ts, start_utc, end_utc):
                        continue

                    msg_type = msg.get("messageType") or msg.get("type") or ""

                    # Stage change activity messages
                    if "ACTIVITY" in msg_type.upper() and "OPPORTUNITY" in msg_type.upper():
                        body = msg.get("body") or msg.get("message") or ""
                        activity["stageChanges"].append({
                            "timestamp": ts,
                            "body": body,
                        })
                        continue

                    # Skip other activity/system messages
                    if "ACTIVITY" in msg_type.upper():
                        continue

                    direction = get_message_direction(msg)
                    channel = get_message_channel(msg)
                    source = classify_message_source(msg) if direction == "outbound" else None

                    activity["messages"].append({
                        "timestamp": ts,
                        "direction": direction,
                        "channel": channel,
                        "source": source,
                        "messageType": msg_type,
                    })

    # 3. Fetch notes
    notes_url = f"{GHL_BASE}/contacts/{contact_id}/notes"
    notes_data, _ = ghl_request(notes_url, auth)
    if notes_data:
        for note in notes_data.get("notes", []):
            ts = note.get("dateAdded")
            if is_today(ts, start_utc, end_utc):
                activity["notes"].append({
                    "timestamp": ts,
                    "body": note.get("body", ""),
                })

    # 4. Fetch tasks (graceful skip if endpoint fails)
    tasks_url = f"{GHL_BASE}/contacts/{contact_id}/tasks"
    tasks_data, tasks_status = ghl_request(tasks_url, auth)
    if tasks_data and tasks_status not in (404, 0):
        for task in tasks_data.get("tasks", []):
            ts = task.get("dateAdded") or task.get("createdAt")
            if is_today(ts, start_utc, end_utc):
                activity["tasks"].append({
                    "timestamp": ts,
                    "title": task.get("title", ""),
                })

    # Only return if there's any activity today
    has_activity = (activity["messages"] or activity["notes"]
                    or activity["tasks"] or activity["stageChanges"])
    return activity if has_activity else None


def build_summary(contacts_with_activity, date_str, total_opps, fetched_at):
    """Build the output JSON structure from per-contact activity."""
    totals = {
        "outbound": {
            "email": {"api": 0, "manual": 0, "automated": 0, "total": 0},
            "sms": {"api": 0, "manual": 0, "automated": 0, "total": 0},
            "call": {"api": 0, "manual": 0, "automated": 0, "total": 0},
        },
        "inbound": {"email": 0, "sms": 0, "call": 0},
        "stageChanges": 0,
        "notes": 0,
        "tasks": 0,
    }

    for contact in contacts_with_activity:
        for msg in contact["messages"]:
            direction = msg.get("direction")
            channel = msg.get("channel", "other")
            source = msg.get("source")

            if direction == "outbound" and channel in totals["outbound"]:
                bucket = totals["outbound"][channel]
                bucket["total"] += 1
                if source == "api":
                    bucket["api"] += 1
                elif source == "manual":
                    bucket["manual"] += 1
                else:
                    bucket["automated"] += 1
            elif direction == "inbound" and channel in totals["inbound"]:
                totals["inbound"][channel] += 1

        totals["stageChanges"] += len(contact["stageChanges"])
        totals["notes"] += len(contact["notes"])
        totals["tasks"] += len(contact["tasks"])

    return {
        "date": date_str,
        "fetchedAt": fetched_at,
        "totalOpportunities": total_opps,
        "contactsWithActivity": len(contacts_with_activity),
        "totals": totals,
        "contacts": contacts_with_activity,
    }


def print_summary(result):
    """Print a visually formatted terminal summary."""
    import re
    t = result["totals"]
    ob = t["outbound"]
    ib = t["inbound"]

    total_out = ob["email"]["total"] + ob["sms"]["total"] + ob["call"]["total"]
    total_in = ib["email"] + ib["sms"] + ib["call"]
    total_api = ob["email"]["api"] + ob["sms"]["api"] + ob["call"]["api"]
    total_manual = ob["email"]["manual"] + ob["sms"]["manual"] + ob["call"]["manual"]
    total_auto = ob["email"]["automated"] + ob["sms"]["automated"] + ob["call"]["automated"]

    DIM = "\033[2m"
    BOLD = "\033[1m"
    GREEN = "\033[32m"
    CYAN = "\033[36m"
    YELLOW = "\033[33m"
    MAGENTA = "\033[35m"
    BLUE = "\033[34m"
    RESET = "\033[0m"
    WHITE = "\033[97m"

    W = 62  # box width (inner)

    def box_top():
        print(f"  {DIM}{'─' * (W + 2)}{RESET}")

    def box_row(left, right="", pad=W):
        content = f"{left}{right}"
        visible = re.sub(r'\033\[[0-9;]*m', '', content)
        spacing = pad - len(visible)
        print(f"  {DIM}│{RESET} {content}{' ' * max(spacing, 0)} {DIM}│{RESET}")

    def box_sep():
        print(f"  {DIM}├{'─' * (W + 2)}┤{RESET}")

    def box_bottom():
        print(f"  {DIM}{'─' * (W + 2)}{RESET}")

    # Header
    print()
    print(f"  {BOLD}{WHITE}Activity Summary{RESET}  {DIM}—  {result['date']}{RESET}")
    print(f"  {DIM}{result['totalOpportunities']} opportunities scanned  ·  "
          f"{result['contactsWithActivity']} with activity{RESET}")
    print()

    # Outbound table
    print(f"  {BOLD}{CYAN}OUTBOUND{RESET}  {DIM}{total_out} total  ({total_api} api · {total_manual} manual · {total_auto} automated){RESET}")
    box_top()
    box_row(f"  {'Channel':<10}  {'API':>8}  {'Manual':>8}  {'Auto':>8}  {'Total':>8}")
    box_sep()
    for channel, key in [("Email", "email"), ("SMS", "sms"), ("Call", "call")]:
        ap = ob[key]["api"]
        m = ob[key]["manual"]
        a = ob[key]["automated"]
        tot = ob[key]["total"]
        if tot == 0:
            box_row(f"  {DIM}{channel:<10}  {ap:>8}  {m:>8}  {a:>8}  {tot:>8}{RESET}")
        else:
            ap_str = f"{BLUE}{ap}{RESET}" if ap > 0 else f"{DIM}{ap}{RESET}"
            m_str = f"{GREEN}{m}{RESET}" if m > 0 else f"{DIM}{m}{RESET}"
            a_str = f"{YELLOW}{a}{RESET}" if a > 0 else f"{DIM}{a}{RESET}"
            t_str = f"{WHITE}{BOLD}{tot}{RESET}"
            box_row(f"  {channel:<10}  {ap_str:>19}  {m_str:>19}  {a_str:>19}  {t_str:>15}")
    box_bottom()

    # Inbound table
    total_in_display = f"  {DIM}{total_in} total{RESET}" if total_in == 0 else f"  {total_in} total"
    print(f"\n  {BOLD}{GREEN}INBOUND{RESET}{total_in_display}")
    if total_in > 0:
        box_top()
        for channel, key in [("Email", "email"), ("SMS", "sms"), ("Call", "call")]:
            v = ib[key]
            if v > 0:
                box_row(f"  {channel:<10}  {BOLD}{v}{RESET}")
        box_bottom()

    # Other activity
    other_items = []
    if t["stageChanges"]:
        other_items.append(("Stage moves", t["stageChanges"], MAGENTA))
    if t["notes"]:
        other_items.append(("Notes", t["notes"], BLUE))
    if t["tasks"]:
        other_items.append(("Tasks", t["tasks"], BLUE))
    if other_items:
        print(f"\n  {BOLD}{YELLOW}OTHER{RESET}")
        box_top()
        for label, count, color in other_items:
            box_row(f"  {label:<16}  {color}{BOLD}{count}{RESET}")
        box_bottom()

    print(f"\n  {DIM}Saved to {OUTPUT_FILE}{RESET}")
    print()


def main():
    start_utc, end_utc, date_str = get_today_range_et()
    fetched_at = datetime.now(timezone.utc).isoformat()

    print(f"Fetching activity for {date_str} (Eastern time)...")

    auth = get_access_token()

    # Step 1: Fetch all opportunities
    opportunities = fetch_opportunities(auth)
    print(f"Found {len(opportunities)} opportunities.")

    # Build contact list (dedupe by contactId)
    contacts = {}
    for opp in opportunities:
        contact = opp.get("contact", {})
        cid = contact.get("id")
        if not cid or cid in contacts:
            continue
        stage_id = opp.get("pipelineStageId", "")
        contacts[cid] = {
            "name": contact.get("name", "Unknown"),
            "stage": STAGES.get(stage_id, "Unknown"),
        }

    print(f"Scanning {len(contacts)} unique contacts for today's activity...")

    # Step 2: Fetch per-contact activity (max 3 concurrent)
    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {
            pool.submit(
                fetch_contact_activity,
                cid, info["name"], info["stage"], auth, start_utc, end_utc
            ): cid
            for cid, info in contacts.items()
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            if done % 10 == 0:
                print(f"  Processed {done}/{len(contacts)} contacts...")
            activity = future.result()
            if activity:
                results.append(activity)

    # Step 3: Build and write output
    result = build_summary(results, date_str, len(opportunities), fetched_at)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(result, f, indent=2)

    print_summary(result)


if __name__ == "__main__":
    main()
