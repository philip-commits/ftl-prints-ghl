#!/usr/bin/env python3
"""
Enrichment layer for FTL Prints GHL pipeline.

Reads:
  /tmp/ftl_pipeline.json  — Phase 1 parsed pipeline data
  /tmp/ftl_convos.json    — Phase 2 conversation metadata (optional)

Writes:
  /tmp/ftl_enriched.json  — Enriched leads with suggestedAction, priority, hints
"""

import json
import re
import sys
from datetime import datetime, timedelta, timezone

# --- Non-US +1 area codes (Canadian + Caribbean — Twilio calls fail) ---
NON_US_NANP_AREA_CODES = frozenset([
    # Canada
    "204", "226", "236", "249", "250", "263", "289", "306", "343", "354",
    "365", "367", "368", "382", "403", "416", "418", "428", "431", "437",
    "438", "450", "460", "468", "474", "506", "514", "519", "548", "579",
    "581", "584", "587", "604", "613", "639", "647", "672", "683", "705",
    "709", "742", "753", "778", "780", "782", "807", "819", "825", "867",
    "873", "879", "902", "905",
    # Caribbean / Atlantic +1 territories
    "242",  # Bahamas
    "246",  # Barbados
    "268",  # Antigua
    "284",  # BVI
    "340",  # USVI (technically US but Twilio treats differently)
    "345",  # Cayman Islands
    "441",  # Bermuda
    "473",  # Grenada
    "649",  # Turks & Caicos
    "664",  # Montserrat
    "721",  # Sint Maarten
    "758",  # St Lucia
    "767",  # Dominica
    "784",  # St Vincent
    "809", "829", "849",  # Dominican Republic
    "868",  # Trinidad
    "869",  # St Kitts
    "876",  # Jamaica
])

# Non-NANP international prefixes (not +1)
NON_NANP_INTL_PREFIXES = ("+41", "+44")

# --- Custom field keys that matter for quoting ---
INFO_FIELDS = ["artwork", "sizes", "quantity", "project_details"]

# --- Cooldown thresholds (business days) ---
COOLDOWN_MULTI_CHANNEL = 3  # after call + email/SMS on same day ("full press")
COOLDOWN_CALL = 3           # before recommending another call
COOLDOWN_EMAIL = 2          # before recommending another email

# Actions that bypass cooldown entirely
COOLDOWN_BYPASS_ACTIONS = {"reply", "outreach", "move", "move_forward"}

PIPELINE_FILE = "/tmp/ftl_pipeline.json"
CONVOS_FILE = "/tmp/ftl_convos.json"
OUTPUT_FILE = "/tmp/ftl_enriched.json"


def load_json(path):
    with open(path) as f:
        return json.load(f)


def is_international(phone):
    """Check if phone number is international (calls will fail via Twilio)."""
    if not phone:
        return False
    normalized = phone.strip().replace(" ", "").replace("(", "").replace(")", "").replace("-", "")
    # Check non-NANP international prefixes first
    for prefix in NON_NANP_INTL_PREFIXES:
        if normalized.startswith(prefix.replace("-", "")):
            return True
    # Check +1 area codes that aren't US
    if normalized.startswith("+1") and len(normalized) >= 5:
        area_code = normalized[2:5]
        return area_code in NON_US_NANP_AREA_CODES
    return False


def business_days_since(dt, now=None):
    """Count Mon-Fri business days between dt and now (exclusive of dt, inclusive of now's date)."""
    if now is None:
        now = datetime.now(timezone.utc)
    start = dt.date()
    end = now.date()
    if start >= end:
        return 0
    count = 0
    current = start + timedelta(days=1)
    while current <= end:
        if current.weekday() < 5:  # Mon=0 .. Fri=4
            count += 1
        current += timedelta(days=1)
    return count


def approx_business_days(calendar_days):
    """Approximate business days from calendar days (fallback when no conversation timestamp)."""
    if calendar_days is None or calendar_days <= 0:
        return 0
    full_weeks = calendar_days // 7
    remainder = calendar_days % 7
    return full_weeks * 5 + min(remainder, 5)


# --- Stage ordering for advancement detection ---
STAGE_ORDER = ["New Lead", "In Progress", "Quote Sent", "Invoice Sent"]
STAGE_IDS = {
    "Quote Sent": "336a5bee-cad2-400f-83fd-cae1bc837029",
    "Invoice Sent": "259ee5f4-5667-4797-948e-f36ec28c70a0",
}

# Phrases that strongly indicate actual pricing was provided (not just mentioned)
# These require a dollar amount nearby to trigger
QUOTE_PRICE_CONTEXT = [
    "per shirt", "per unit", "per piece", "per item", "each",
    "total", "subtotal", "comes to", "would be", "price is",
    "pricing below", "breakdown", "here's what", "your order",
]

# Phrases that indicate a quote was sent even without a dollar amount in the body
# (e.g., quote sent as attachment or via GHL quoting tool)
QUOTE_SENT_PHRASES = [
    "attached is your quote", "here's your quote", "here is your quote",
    "sent you a quote", "sent the quote", "sending your quote",
    "attached is the quote", "quote attached", "estimate attached",
    "proposal attached", "here's the pricing", "here is the pricing",
    "sent you the pricing", "pricing is attached",
]

# Phrases that mention "quote" but do NOT mean one was sent — skip these
QUOTE_FALSE_POSITIVES = [
    "send you a quote", "get you a quote", "put together a quote",
    "prepare a quote", "work up a quote", "quote once", "quote after",
    "quote when", "need .* to quote", "before i can quote",
]

def detect_quote_sent_in_messages(messages):
    """
    Scan outbound messages for strong indicators that actual pricing/quote was provided.

    Returns True only when there's high confidence a quote was sent, not just discussed.
    Requires either:
      1. A dollar amount ($X) paired with a pricing-context phrase, OR
      2. An explicit "quote attached/sent" phrase
    """
    for msg in (messages or []):
        if msg.get("direction") != "outbound":
            continue
        body = (msg.get("body") or "").lower()
        if not body:
            continue

        # Check for explicit "quote sent/attached" phrases (no $ needed)
        for phrase in QUOTE_SENT_PHRASES:
            if phrase in body:
                return True

        # Check for dollar amount + pricing context (strong signal)
        has_dollar = bool(re.search(r'\$\d', body))
        if has_dollar:
            # Make sure it's not a false positive like "send you a quote"
            is_false_positive = any(re.search(fp, body) for fp in QUOTE_FALSE_POSITIVES)
            if is_false_positive:
                continue
            # Dollar amount + pricing context phrase = likely a real quote
            for phrase in QUOTE_PRICE_CONTEXT:
                if phrase in body:
                    return True
            # Multiple dollar amounts in one message = line items (very strong)
            if len(re.findall(r'\$\d', body)) >= 2:
                return True

    return False


BUDGET_TIERS = {
    "$0 - $149": "low",
    "$150 - $499": "standard",
    "$500 - $999": "standard",
    "$1,000+": "high",
}


def get_value_tier(lead):
    """Return 'high', 'standard', or 'low' based on budget string or monetaryValue."""
    budget = lead.get("budget") or lead.get("Budget") or ""
    if budget in BUDGET_TIERS:
        return BUDGET_TIERS[budget]
    mv = lead.get("monetaryValue") or lead.get("monetary_value") or 0
    try:
        mv = float(mv)
    except (ValueError, TypeError):
        mv = 0
    if mv >= 1000:
        return "high"
    if mv >= 150:
        return "standard"
    return "low"


def get_missing_info(lead):
    """Return list of missing custom field names needed for quoting."""
    missing = []
    for field in INFO_FIELDS:
        val = lead.get(field)
        if val is None or val == "" or val == []:
            missing.append(field)
    return missing


def check_waiting_on_artwork(lead):
    """Check if project_details suggests artwork is forthcoming."""
    details = (lead.get("project_details") or "").lower()
    return "will provide" in details or "new logo" in details


def parse_timestamp(ts):
    """Parse a GHL timestamp (ISO string or epoch millis) into a datetime. Returns None on failure."""
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, TypeError, OSError):
        return None


def enrich_from_opportunity(lead):
    """Compute fields derived from opportunity data only."""
    phone = lead.get("phone", "")
    enriched = {
        "isInternational": is_international(phone),
        "missingInfo": get_missing_info(lead),
        "waitingOnArtwork": check_waiting_on_artwork(lead),
        "hasArtwork": bool(lead.get("artwork")) and lead.get("artwork") != [],
        "hasQuantity": bool(lead.get("quantity")),
        "hasSizes": bool(lead.get("sizes")),
        "hasProjectDetails": bool(lead.get("project_details")),
    }
    return enriched


def enrich_from_conversation(lead, convo):
    """Compute fields derived from conversation metadata."""
    if convo is None:
        return {
            "needsReply": False,
            "hasManualOutreach": False,
            "daysSinceLastContact": None,
            "daysSinceLastCall": None,
            "daysSinceLastSms": None,
            "daysSinceLastEmail": None,
            "outboundCount": 0,
            "noConversation": True,
            "conversationId": None,
            "notes": [],
            "conversationHistory": [],
        }

    now = datetime.now(timezone.utc)
    days_since = None
    last_date = convo.get("lastMessageDate") or convo.get("lastManualMessageDate")
    if last_date:
        dt = parse_timestamp(last_date)
        if dt:
            days_since = business_days_since(dt, now)

    # Per-channel business days since last outbound
    days_call = days_sms = days_email = None
    for field, attr in [("lastOutboundCallDate", "days_call"),
                        ("lastOutboundSmsDate", "days_sms"),
                        ("lastOutboundEmailDate", "days_email")]:
        dt = parse_timestamp(convo.get(field))
        if dt:
            if attr == "days_call":
                days_call = business_days_since(dt, now)
            elif attr == "days_sms":
                days_sms = business_days_since(dt, now)
            else:
                days_email = business_days_since(dt, now)

    messages = convo.get("messages", [])

    return {
        "needsReply": (convo.get("unreadCount", 0) or 0) > 0
            and convo.get("lastMessageDirection") == "inbound",
        "hasManualOutreach": convo.get("lastOutboundMessageAction") == "manual",
        "daysSinceLastContact": days_since,
        "daysSinceLastCall": days_call,
        "daysSinceLastSms": days_sms,
        "daysSinceLastEmail": days_email,
        "outboundCount": convo.get("outboundCount") or 0,
        "noConversation": False,
        "conversationId": convo.get("conversationId"),
        "notes": convo.get("notes", []),
        "conversationHistory": messages,
        "quoteSentDetected": detect_quote_sent_in_messages(messages),
    }


def decide_action(lead):
    """
    Decision tree — first match wins.

    Uses business-day timing, value tiers, and stage-aware thresholds.
    Returns (suggestedAction, suggestedPriority, hint).
    """
    stage = lead.get("stage", "")
    days_in_stage = lead.get("days_in_stage", 0)
    needs_reply = lead.get("needsReply", False)
    has_manual = lead.get("hasManualOutreach", False)
    is_intl = lead.get("isInternational", False)
    tier = get_value_tier(lead)
    outbound_count = lead.get("outboundCount", 0) or 0

    # Primary timing signal: business days since last contact (from conversation)
    bdays = lead.get("daysSinceLastContact")
    if bdays is None:
        # Fallback: approximate from calendar days in stage
        bdays = approx_business_days(days_in_stage)

    # Attempt threshold: high-value gets 4, everyone else 3
    min_attempts = 4 if tier == "high" else 3

    # Thresholds by tier
    thresholds = {
        "high":     {"call": 1, "followup": 3, "final": 6, "hv_extra": 10, "move": 14},
        "standard": {"call": 1, "followup": 3, "final": 6, "hv_extra": None, "move": 10},
        "low":      {"call": 1, "followup": 2, "final": 5, "hv_extra": None, "move": 7},
    }
    # Quote Sent / Invoice Sent uses tight windows regardless of value
    if stage in ("Quote Sent", "Invoice Sent"):
        t = {"call": 1, "followup": 2, "final": 5, "hv_extra": None, "move": 7}
    else:
        t = thresholds.get(tier, thresholds["standard"])

    # --- Rule order: first match wins ---

    # 1. Needs reply — customer is waiting
    if needs_reply:
        return ("reply", "high", "Inbound message waiting — reply needed")

    # 1.5. Stage advancement — quote sent but stage hasn't been updated
    #       These stages indicate the opp hasn't reached "Quote Sent" yet
    quote_detected = lead.get("quoteSentDetected", False)
    if quote_detected and stage in ("New Lead", "In Progress"):
        return ("move_forward", "high",
                f"Quote was sent but stage is still '{stage}' — move to Quote Sent")

    # 2. New Lead or no manual outreach yet — can't escalate what hasn't started
    if stage == "New Lead" or not has_manual:
        label = "New lead" if stage == "New Lead" else "No manual outreach yet"
        return ("outreach", "high", f"{label} — send personalized welcome")

    # 3. Quote Sent / Invoice Sent — money on the table, own escalation ladder
    if stage in ("Quote Sent", "Invoice Sent"):
        stage_label = stage.lower()
        if bdays >= t["move"] and outbound_count >= min_attempts:
            return ("move", "info", f"{bdays} bdays since {stage_label}, {outbound_count} attempts, no response — move to Cooled Off")
        if bdays >= t["move"]:
            return ("follow_up_email", "medium", f"{bdays} bdays since {stage_label} but only {outbound_count}/{min_attempts} attempts — follow up before closing")
        if bdays >= t["final"]:
            return ("final_attempt_email", "medium", f"{bdays} bdays since {stage_label} — final follow-up before closing")
        if bdays >= t["followup"]:
            return ("follow_up_email", "medium", f"{bdays} bdays since {stage_label} — check if they have questions")
        if bdays >= t["call"]:
            if is_intl:
                return ("follow_up_email", "medium", f"{bdays} bday(s) since {stage_label}, international — email follow-up")
            return ("call", "high", f"{bdays} bday(s) since {stage_label} — call to discuss")
        return ("none", "none", f"{stage} recently, waiting for response")

    # 4. High-value extra attempt (10-13 bdays) — one more try before moving
    if tier == "high" and t["hv_extra"] is not None and t["hv_extra"] <= bdays < t["move"]:
        return ("high_value_followup", "high", f"High-value lead at {bdays} bdays — extra attempt before closing out")

    # 5. Move threshold — stale lead (requires both time AND attempts)
    if bdays >= t["move"] and outbound_count >= min_attempts:
        return ("move", "info", f"{bdays} bdays in {stage}, {outbound_count} attempts, no response — move to Cooled Off")
    if bdays >= t["move"]:
        return ("follow_up_email", "medium", f"{bdays} bdays in {stage} but only {outbound_count}/{min_attempts} attempts — follow up before closing")

    # 6. Final attempt
    if bdays >= t["final"]:
        return ("final_attempt_email", "medium", f"{bdays} bdays no response — final follow-up before moving to Cooled Off")

    # 7. Follow-up email
    if bdays >= t["followup"]:
        return ("follow_up_email", "medium", f"{bdays} bdays no response — follow-up email")

    # 8. First follow-up (1+ bday)
    if bdays >= t["call"]:
        if is_intl:
            return ("follow_up_email", "medium", f"{bdays} bday(s) no response, international — email only")
        return ("call", "high", f"{bdays} bday(s) no response, domestic — call them")

    # 10. Default — contacted recently
    return ("none", "none", "Contacted recently, waiting for response")


def apply_cooldown(lead, action, priority, hint):
    """
    Post-process decide_action() result — suppress or downgrade if recent
    multi-channel or per-channel outreach triggers a cooldown.

    Returns (action, priority, hint) — possibly modified.
    """
    stage = lead.get("stage", "")

    # Bypass: these actions should never be suppressed
    if action in COOLDOWN_BYPASS_ACTIONS:
        return action, priority, hint

    days_call = lead.get("daysSinceLastCall")
    days_sms = lead.get("daysSinceLastSms")
    days_email = lead.get("daysSinceLastEmail")

    # 1. Multi-channel "full press" detection:
    #    call + (email or SMS) both happened within 1 bday of each other
    if days_call is not None and (days_sms is not None or days_email is not None):
        other = min(d for d in (days_sms, days_email) if d is not None)
        # Both happened recently AND within 1 bday of each other
        if abs(days_call - other) <= 1:
            most_recent = min(days_call, other)
            if most_recent < COOLDOWN_MULTI_CHANNEL:
                return ("none", "none",
                        f"Cooldown: full press {most_recent} bday(s) ago, "
                        f"wait {COOLDOWN_MULTI_CHANNEL - most_recent} more bday(s)")

    # 2. Call cooldown: called recently → downgrade to email or suppress
    is_call_action = action in ("call", "high_value_followup")
    if is_call_action and days_call is not None and days_call < COOLDOWN_CALL:
        # Try downgrading to email if email cooldown allows
        if days_email is None or days_email >= COOLDOWN_EMAIL:
            return ("follow_up_email", priority,
                    f"Cooldown: called {days_call} bday(s) ago — email instead")
        return ("none", "none",
                f"Cooldown: called {days_call} bday(s) ago, "
                f"emailed {days_email} bday(s) ago — wait")

    # 3. Email cooldown: emailed recently → suppress email actions
    is_email_action = action in ("follow_up_email", "final_attempt_email")
    if is_email_action and days_email is not None and days_email < COOLDOWN_EMAIL:
        return ("none", "none",
                f"Cooldown: emailed {days_email} bday(s) ago, "
                f"wait {COOLDOWN_EMAIL - days_email} more bday(s)")

    return action, priority, hint


def main():
    # Load pipeline data (required)
    try:
        pipeline = load_json(PIPELINE_FILE)
    except FileNotFoundError:
        print(f"ERROR: {PIPELINE_FILE} not found. Run Phase 1 first.", file=sys.stderr)
        sys.exit(1)

    # Load conversation data (optional — graceful degradation)
    convos = {}
    try:
        convos = load_json(CONVOS_FILE)
    except FileNotFoundError:
        print(f"WARNING: {CONVOS_FILE} not found. Proceeding with opportunity-only data.",
              file=sys.stderr)

    active = pipeline.get("active", [])
    enriched_leads = []

    for lead in active:
        contact_id = lead.get("contactId", "")

        # Merge opportunity-derived fields
        lead.update(enrich_from_opportunity(lead))

        # Merge conversation-derived fields
        convo = convos.get(contact_id)
        lead.update(enrich_from_conversation(lead, convo))

        # Run decision tree, then apply cooldown
        action, priority, hint = decide_action(lead)
        action, priority, hint = apply_cooldown(lead, action, priority, hint)
        lead["suggestedAction"] = action
        lead["suggestedPriority"] = priority
        lead["hint"] = hint

        enriched_leads.append(lead)

    # Build output
    output = {
        "leads": enriched_leads,
        "inactiveSummary": pipeline.get("inactive_summary", {}),
        "inactiveContacts": pipeline.get("inactive_contacts", []),
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    # Print summary
    action_counts = {}
    priority_counts = {}
    for lead in enriched_leads:
        a = lead["suggestedAction"]
        p = lead["suggestedPriority"]
        action_counts[a] = action_counts.get(a, 0) + 1
        priority_counts[p] = priority_counts.get(p, 0) + 1

    print(f"Enriched {len(enriched_leads)} active leads.")
    print(f"  Actions: {action_counts}")
    print(f"  Priorities: {priority_counts}")
    if not convos:
        print("  (no conversation data — used opportunity-only enrichment)")
    print(f"Output written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
