#!/usr/bin/env python3
"""
Fetch conversation metadata for active pipeline leads via GHL REST API.

Reads:
  /tmp/ftl_pipeline.json   — Phase 1 parsed pipeline data

Writes:
  /tmp/ftl_convos.json     — Conversation metadata keyed by contactId
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ghl_auth import get_access_token

PIPELINE_FILE = "/tmp/ftl_pipeline.json"
OUTPUT_FILE = "/tmp/ftl_convos.json"
LOCATION_ID = "iCyLg9rh8NtPpTfFCcGk"
GHL_BASE = "https://services.leadconnectorhq.com"
MAX_WORKERS = 3

# Channel type mapping for friendly names
CHANNEL_MAP_NAMES = {
    "TYPE_EMAIL": "email",
    "TYPE_SMS": "sms",
    "TYPE_CALL": "call",
}


class _HTMLStripper(HTMLParser):
    """Lightweight HTML-to-text converter using stdlib html.parser."""

    def __init__(self):
        super().__init__()
        self._parts = []
        self._skip = False  # skip content inside <style>/<script>

    def handle_starttag(self, tag, attrs):
        if tag in ("style", "script"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._skip = False

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def get_text(self):
        return " ".join("".join(self._parts).split())


def _html_to_text(html_str):
    """Convert HTML to plain text, stripping tags and collapsing whitespace."""
    if not html_str:
        return ""
    cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_str, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<script[^>]*>.*?</script>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    s = _HTMLStripper()
    try:
        s.feed(cleaned)
        return s.get_text().strip()
    except Exception:
        return html_str


def strip_html(html_str):
    """Strip HTML tags, remove quoted reply chains, and collapse whitespace. Returns plain text."""
    if not html_str:
        return ""
    # Remove <style> and <script> blocks before parsing (belt and suspenders)
    cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_str, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<script[^>]*>.*?</script>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    # Trim quoted reply chains (gmail_quote, blockquote, "On ... wrote:")
    cleaned = re.sub(r'<div\s+class="gmail_quote[^"]*".*', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<blockquote[^>]*>.*', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    s = _HTMLStripper()
    try:
        s.feed(cleaned)
        text = s.get_text()
        # Trim "On <date> ... wrote:" trailing patterns (plain-text quoted replies)
        text = re.split(r'\s*On\s+\w{3},\s+\w{3}\s+\d', text)[0]
        return text.strip()
    except Exception:
        return html_str


def extract_thread_messages(html_str, parent_direction):
    """Extract individual messages from an email thread's quoted replies.

    GHL often does not create separate message records for inbound email replies —
    they only appear as quoted text (gmail_quote / blockquote) inside the outbound
    reply. This function parses the thread and returns a list of embedded messages.

    Returns list of dicts: [{"body": str, "direction": str, "sender_hint": str}]
    The list does NOT include the top-level message (caller handles that).
    """
    if not html_str:
        return []

    thread_msgs = []

    # The attribution line format in actual GHL HTML is:
    # On Mon, Mar 9, 2026 at 10:43 AM Patricia hernandez &lt;<a href="mailto:email">email</a>&gt; wrote:<br>
    # Or Spanish: El mar, 3 mar 2026 a las 9:51, <a href="mailto:email">email</a> escribió:<br>
    # The email is inside an <a> tag with mailto:, and the angle brackets are &lt;/&gt;

    # Pattern approach: find "wrote:" or "escribió:" preceded by attribution text,
    # then extract the sender email from the nearby mailto: link
    attr_pattern = re.compile(
        r'(?:On\s+\w{3},\s+\w{3}\s+\d{1,2},\s+\d{4}\s+at\s+[\d:]+\s*[AP]M'  # Gmail
        r'|On\s+\w{3}\s+\d{1,2},\s+\d{4},?\s+at\s+[\d:]+\s*[AP]M'            # Apple
        r'|El\s+\w{3},\s+\d{1,2}\s+\w{3}\s+\d{4}\s+a\s+las\s+[\d:]+)'        # Spanish
        r'(.*?)'  # capture everything between date and wrote (contains sender)
        r'(?:wrote|escribi[oó])\s*:\s*(?:<br\s*/?>)?',
        re.IGNORECASE | re.DOTALL)

    for match in attr_pattern.finditer(html_str):
        sender_block = match.group(1)

        # Extract email from mailto: link in the sender block
        mailto_match = re.search(r'mailto:([^"\'>\s]+)', sender_block, re.IGNORECASE)
        if not mailto_match:
            # Try plain text email pattern
            mailto_match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', sender_block)
        if not mailto_match:
            continue
        sender_email = mailto_match.group(1) if mailto_match.lastindex else mailto_match.group(0)

        # Extract sender name: text before &lt; or < in the sender block
        name_text = _html_to_text(sender_block).strip()
        # Remove email and angle brackets from name
        name_text = re.sub(r'[<>].*', '', name_text).strip().rstrip(',').strip()
        if not name_text:
            name_text = sender_email.split('@')[0]

        # Get the content after this attribution — it's in the next blockquote
        after_attr = html_str[match.end():]
        # Find the blockquote content (first blockquote after attribution)
        bq_match = re.search(
            r'<blockquote[^>]*>(.*?)(?:</blockquote>)',
            after_attr, re.DOTALL | re.IGNORECASE)
        if not bq_match:
            continue

        quoted_html = bq_match.group(1)
        # Strip nested quotes from this block (we'll get them in their own iteration)
        quoted_html = re.sub(r'<div\s+class="gmail_quote[^"]*".*', '', quoted_html, flags=re.DOTALL | re.IGNORECASE)
        quoted_html = re.sub(r'<blockquote[^>]*>.*', '', quoted_html, flags=re.DOTALL | re.IGNORECASE)
        # Also strip nested Apple Mail blockquotes
        quoted_html = re.sub(r'<br><blockquote\s+type="cite".*', '', quoted_html, flags=re.DOTALL | re.IGNORECASE)

        body = _html_to_text(quoted_html)
        # Trim "Sent from my iPhone" and similar signatures
        body = re.split(r'\s*Sent from my iPhone', body)[0].strip()
        if not body:
            continue

        # Determine direction based on sender email.
        # "via" senders (e.g. "Patricia via Fort Lauderdale Screen Printing
        # <sales@email.fortlauderdalescreenprinting.com>") are inbound contacts
        # whose replies are routed through the business email system.
        is_via = ' via ' in name_text.lower()
        is_business = any(domain in sender_email.lower() for domain in
                         ['ftlprints.com', 'fortlauderdalescreenprinting.com',
                          'email.fortlauderdalescreenprinting.com'])
        if is_via:
            direction = "inbound"
        elif is_business:
            direction = "outbound"
        else:
            direction = "inbound"

        thread_msgs.append({
            "body": body,
            "direction": direction,
            "sender_hint": f"{name_text} <{sender_email}>",
        })

    return thread_msgs


def fetch_notes(contact_id, auth):
    """Fetch all notes for a contact, sorted by dateAdded descending."""
    url = f"{GHL_BASE}/contacts/{contact_id}/notes"
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
            notes_raw = body.get("notes", [])
            # Sort by dateAdded descending (newest first)
            notes_raw.sort(key=lambda n: n.get("dateAdded", ""), reverse=True)
            return [{"body": n.get("body", ""), "dateAdded": n.get("dateAdded", "")}
                    for n in notes_raw]
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return []
        except Exception:
            if attempt == 0:
                time.sleep(2)
                continue
            return []


def fetch_email_body(message_id, auth, include_thread=False, parent_direction=None):
    """Fetch an individual email message to get its accurate body.

    The list endpoint often omits or corrupts email bodies (returns quoted
    thread text or empty body). The individual endpoint has the real HTML.

    If include_thread=True, also extracts embedded thread messages from quoted
    replies (GHL often doesn't create separate records for email replies).

    Returns:
        If include_thread=False: plain text body (str)
        If include_thread=True: (plain_text_body, thread_messages_list)
    """
    url = f"{GHL_BASE}/conversations/messages/{message_id}"
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        # Response wraps message in {"message": {...}, "traceId": ...}
        msg = data.get("message", data)
        raw_body = msg.get("body", "")
        text = strip_html(raw_body) if raw_body else ""
        if include_thread:
            thread = extract_thread_messages(raw_body, parent_direction or "outbound") if raw_body else []
            return text, thread
        return text
    except Exception:
        if include_thread:
            return "", []
        return ""


def _fetch_messages_page(conversation_id, auth, last_message_id=None):
    """Fetch a single page of messages. Returns (raw_messages_list, next_cursor_id)."""
    url = f"{GHL_BASE}/conversations/{conversation_id}/messages?limit=100"
    if last_message_id:
        url += f"&lastMessageId={last_message_id}"
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
    # Messages may be nested: body["messages"]["messages"] or flat
    raw = body.get("messages", body.get("data", []))
    if isinstance(raw, dict):
        messages = raw.get("messages", [])
    else:
        messages = raw
    # Determine next cursor: use lastMessageId from response, or last message's id
    next_cursor = body.get("lastMessageId")
    if not next_cursor and messages:
        next_cursor = messages[-1].get("id")
    return messages, next_cursor


def fetch_messages(conversation_id, auth):
    """Fetch messages for a conversation: outbound count, per-channel timestamps, and recent message bodies.

    Paginates through all messages (up to 500) so long email threads are not truncated.
    """
    MAX_PAGES = 5        # Up to 500 messages total
    MAX_BODY_MSGS = 50   # Process bodies for up to 50 most recent messages
    MAX_EMAIL_FETCHES = 40  # Fetch up to 40 email bodies individually

    # Direction lives at top level for SMS/CALL, but in meta.email.direction for EMAIL
    def get_direction(m):
        d = m.get("direction")
        if d:
            return d
        meta = m.get("meta")
        if isinstance(meta, dict):
            for v in meta.values():
                if isinstance(v, dict) and "direction" in v:
                    return v["direction"]
        return None

    for attempt in range(2):
        try:
            # Paginate to collect all messages
            all_messages = []
            cursor = None
            for _page in range(MAX_PAGES):
                page_msgs, next_cursor = _fetch_messages_page(
                    conversation_id, auth, last_message_id=cursor)
                if not page_msgs:
                    break
                all_messages.extend(page_msgs)
                # Stop if we got fewer than a full page (no more messages)
                if len(page_msgs) < 100:
                    break
                # Stop if cursor didn't advance (safety valve)
                if next_cursor == cursor:
                    break
                cursor = next_cursor

            messages = all_messages
            count = sum(1 for m in messages if get_direction(m) == "outbound")

            # Track most recent outbound timestamp per channel (direct only, not campaign)
            channel_map = {
                "TYPE_CALL": "lastOutboundCallDate",
                "TYPE_SMS": "lastOutboundSmsDate",
                "TYPE_EMAIL": "lastOutboundEmailDate",
            }
            channel_dates = {v: None for v in channel_map.values()}
            for m in messages:
                if get_direction(m) != "outbound":
                    continue
                msg_type = m.get("messageType", "")
                if msg_type not in channel_map:
                    continue
                ts = m.get("dateAdded") or m.get("createdAt")
                if ts and (channel_dates[channel_map[msg_type]] is None
                           or ts > channel_dates[channel_map[msg_type]]):
                    channel_dates[channel_map[msg_type]] = ts

            # Extract message bodies for the most recent messages (newest first).
            # For emails, the list endpoint often omits or corrupts bodies,
            # so we fetch individually for accurate content.
            # Also extract embedded thread messages that GHL doesn't create
            # separate records for (common with Gmail reply chains).

            # First pass: fetch all email bodies and extract thread messages.
            # We need all main email bodies first so we can dedup thread messages
            # against them (a thread message may duplicate an API message).
            email_data = []  # [(index, text, thread_msgs)]
            email_fetches = 0
            for idx, m in enumerate(messages[:MAX_BODY_MSGS]):
                msg_type = m.get("messageType", "")
                if msg_type != "TYPE_EMAIL" or email_fetches >= MAX_EMAIL_FETCHES:
                    continue
                msg_id = m.get("id")
                direction = get_direction(m) or "unknown"
                text, thread_msgs = fetch_email_body(
                    msg_id, auth, include_thread=True,
                    parent_direction=direction) if msg_id else ("", [])
                email_fetches += 1
                email_data.append((idx, text, thread_msgs))

            # Build dedup set from all main email bodies
            seen_bodies = set()
            for _, text, _ in email_data:
                if text:
                    seen_bodies.add(text[:100])

            # Second pass: assemble messages in order, inserting thread messages
            # after their parent email.
            recent_messages = []
            email_data_by_idx = {idx: (text, thread_msgs) for idx, text, thread_msgs in email_data}

            for idx, m in enumerate(messages[:MAX_BODY_MSGS]):
                direction = get_direction(m) or "unknown"
                msg_type = m.get("messageType", "")
                channel = CHANNEL_MAP_NAMES.get(msg_type, msg_type)
                ts = m.get("dateAdded") or m.get("createdAt") or ""

                if idx in email_data_by_idx:
                    text, thread_msgs = email_data_by_idx[idx]

                    # Add the main message
                    if text:
                        if len(text) > 500:
                            text = text[:500] + "..."
                        recent_messages.append({
                            "direction": direction,
                            "channel": channel,
                            "body": text,
                            "date": ts,
                        })

                    # Add thread messages that GHL didn't create records for
                    for tm in thread_msgs:
                        body = tm["body"]
                        if len(body) > 500:
                            body = body[:500] + "..."
                        # Skip if we already have this message (dedup by first 100 chars)
                        if body[:100] in seen_bodies:
                            continue
                        seen_bodies.add(body[:100])
                        recent_messages.append({
                            "direction": tm["direction"],
                            "channel": "email",
                            "body": body,
                            "date": ts,  # Use parent timestamp (thread msgs lack exact ts)
                            "from_thread": True,
                        })
                    continue

                # SMS/call bodies are reliable from list endpoint
                text = m.get("body") or m.get("message") or ""
                if len(text) > 500:
                    text = text[:500] + "..."
                if not text:
                    continue
                recent_messages.append({
                    "direction": direction,
                    "channel": channel,
                    "body": text,
                    "date": ts,
                })

            return count, channel_dates, recent_messages
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            return None, {}, []
        except Exception:
            if attempt == 0:
                time.sleep(2)
                continue
            return None, {}, []


def fetch_conversation(contact_id, auth, stage=""):
    """Fetch conversation metadata + outbound count for a single contact. Returns (contactId, data|None)."""
    url = (f"{GHL_BASE}/conversations/search"
           f"?contactId={contact_id}&locationId={LOCATION_ID}")
    req = urllib.request.Request(url, headers={
        "Authorization": auth,
        "Version": "2021-07-28",
        "Accept": "application/json",
        "User-Agent": "FTL-Prints-Pipeline/1.0",
    })

    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read())
            conversations = body.get("conversations", [])
            if not conversations:
                if stage != "New Lead":
                    notes = fetch_notes(contact_id, auth)
                    if notes:
                        return (contact_id, {"notes": notes})
                return (contact_id, None)
            convo = conversations[0]
            convo_id = convo.get("id")

            # Fetch outbound message count, per-channel timestamps, and recent messages
            if convo_id:
                outbound_count, channel_dates, recent_messages = fetch_messages(convo_id, auth)
            else:
                outbound_count, channel_dates, recent_messages = None, {}, []

            # Fetch contact notes (skip for New Leads — they won't have any)
            notes = fetch_notes(contact_id, auth) if stage != "New Lead" else []

            result = {
                "unreadCount": convo.get("unreadCount", 0),
                "lastMessageDirection": convo.get("lastMessageDirection"),
                "lastMessageDate": convo.get("lastMessageDate"),
                "lastMessageType": convo.get("lastMessageType"),
                "lastOutboundMessageAction": convo.get("lastOutboundMessageAction"),
                "lastManualMessageDate": convo.get("lastManualMessageDate"),
                "conversationId": convo_id,
                "outboundCount": outbound_count,
                "notes": notes,
                "messages": recent_messages,
            }
            result.update(channel_dates)
            return (contact_id, result)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("ERROR: 401 Unauthorized from GHL API.", file=sys.stderr)
                print("Token expired or invalid. To fix:", file=sys.stderr)
                print("  python3 .claude/skills/ghl/assets/ghl_oauth_setup.py <client_id> <client_secret>", file=sys.stderr)
                print("Or update the PIT token in ~/.claude/mcp.json", file=sys.stderr)
                sys.exit(1)
            if e.code in (500, 503) and attempt == 0:
                time.sleep(2)
                continue
            print(f"  WARNING: HTTP {e.code} for contact {contact_id}, skipping",
                  file=sys.stderr)
            return (contact_id, None)
        except Exception as e:
            if attempt == 0:
                time.sleep(2)
                continue
            print(f"  WARNING: {e} for contact {contact_id}, skipping",
                  file=sys.stderr)
            return (contact_id, None)


def main():
    # Load pipeline data
    try:
        pipeline = json.loads(Path(PIPELINE_FILE).read_text())
    except FileNotFoundError:
        print(f"ERROR: {PIPELINE_FILE} not found. Run Phase 1 first.", file=sys.stderr)
        sys.exit(1)

    active = pipeline.get("active", [])
    leads = [(lead["contactId"], lead.get("stage", ""))
             for lead in active if lead.get("contactId")]
    print(f"Fetching conversations for {len(leads)} active leads...")

    # Load auth once (read-only, shared across threads)
    auth = get_access_token()

    # Fetch concurrently with max 3 workers (respects GHL rate limit)
    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_conversation, cid, auth, stage): cid
                   for cid, stage in leads}
        for future in as_completed(futures):
            contact_id, data = future.result()
            results[contact_id] = data

    # Write output
    Path(OUTPUT_FILE).write_text(json.dumps(results, indent=2))

    # Summary
    found = sum(1 for v in results.values() if v is not None)
    unread = sum(1 for v in results.values()
                 if v and (v.get("unreadCount") or 0) > 0)
    with_notes = sum(1 for v in results.values()
                     if v and len(v.get("notes") or []) > 0)
    with_msgs = sum(1 for v in results.values()
                    if v and len(v.get("messages") or []) > 0)
    print(f"Done. {found}/{len(leads)} contacts have conversations "
          f"({unread} with unread messages, {with_notes} with notes, "
          f"{with_msgs} with message bodies).")
    print(f"Output written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
