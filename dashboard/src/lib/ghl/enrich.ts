import { NON_US_NANP_AREA_CODES, NON_NANP_INTL_PREFIXES } from "../constants";
import type { ParsedLead, ConversationMeta, EnrichedLead, NoteEntry, MessageEntry } from "./types";

const INFO_FIELDS = ["artwork", "sizes", "quantity", "project_details"];

// Cooldown: don't suggest contact if we just reached out
const COOLDOWN_DAYS = 1; // contacted yesterday or today → suppress
const COOLDOWN_BYPASS_ACTIONS = new Set(["reply", "move"]);

function isInternational(phone: string): boolean {
  if (!phone) return false;
  const normalized = phone.replace(/[\s()-]/g, "");
  for (const prefix of NON_NANP_INTL_PREFIXES) {
    if (normalized.startsWith(prefix.replace("-", ""))) return true;
  }
  if (normalized.startsWith("+1") && normalized.length >= 5) {
    const areaCode = normalized.slice(2, 5);
    return NON_US_NANP_AREA_CODES.has(areaCode);
  }
  return false;
}

function businessDaysSince(dt: Date, now: Date = new Date()): number {
  const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start >= end) return 0;
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function approxBusinessDays(calendarDays: number | null): number {
  if (calendarDays === null || calendarDays <= 0) return 0;
  const fullWeeks = Math.floor(calendarDays / 7);
  const remainder = calendarDays % 7;
  return fullWeeks * 5 + Math.min(remainder, 5);
}

function parseTimestamp(ts: string | number | null | undefined): Date | null {
  if (ts == null) return null;
  try {
    if (typeof ts === "number") return new Date(ts > 1e12 ? ts : ts * 1000);
    return new Date(ts);
  } catch {
    return null;
  }
}


function isReactivated(notes: NoteEntry[]): boolean {
  return notes.some(n => n.body.startsWith("Reactivated from Cooled Off"));
}

function getMissingInfo(lead: ParsedLead): string[] {
  const missing: string[] = [];
  for (const field of INFO_FIELDS) {
    const val = (lead as unknown as Record<string, unknown>)[field];
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
      missing.push(field);
    }
  }
  return missing;
}

function checkWaitingOnArtwork(lead: ParsedLead): boolean {
  const details = (lead.project_details || "").toLowerCase();
  return details.includes("will provide") || details.includes("new logo");
}

interface EnrichmentFields {
  isInternational: boolean;
  missingInfo: string[];
  waitingOnArtwork: boolean;
  hasArtwork: boolean;
  hasQuantity: boolean;
  hasSizes: boolean;
  hasProjectDetails: boolean;
}

function enrichFromOpportunity(lead: ParsedLead): EnrichmentFields {
  return {
    isInternational: isInternational(lead.phone),
    missingInfo: getMissingInfo(lead),
    waitingOnArtwork: checkWaitingOnArtwork(lead),
    hasArtwork: Boolean(lead.artwork) && (lead.artwork as string[]).length > 0,
    hasQuantity: Boolean(lead.quantity),
    hasSizes: Boolean(lead.sizes),
    hasProjectDetails: Boolean(lead.project_details),
  };
}

interface ConvoFields {
  needsReply: boolean;
  lastMessageType: string | null;
  hasManualOutreach: boolean;
  daysSinceLastContact: number | null;
  daysSinceLastCall: number | null;
  daysSinceLastSms: number | null;
  daysSinceLastEmail: number | null;
  outboundCount: number;
  noConversation: boolean;
  conversationId: string | null;
  notes: NoteEntry[];
  conversationHistory: MessageEntry[];
}

function enrichFromConversation(convo: ConversationMeta | null): ConvoFields {
  if (!convo) {
    return {
      needsReply: false,
      lastMessageType: null,
      hasManualOutreach: false,
      daysSinceLastContact: null,
      daysSinceLastCall: null,
      daysSinceLastSms: null,
      daysSinceLastEmail: null,
      outboundCount: 0,
      noConversation: true,
      conversationId: null,
      notes: [],
      conversationHistory: [],
    };
  }

  const now = new Date();
  let daysSince: number | null = null;
  // Use manual message date only — automated welcome messages (form
  // submission confirmations) should NOT count as contact for cooldown.
  const lastDate = convo.lastManualMessageDate;
  if (lastDate) {
    const dt = parseTimestamp(lastDate);
    if (dt) daysSince = businessDaysSince(dt, now);
  }

  const channelFields = [
    { src: convo.lastOutboundCallDate, key: "daysSinceLastCall" },
    { src: convo.lastOutboundSmsDate, key: "daysSinceLastSms" },
    { src: convo.lastOutboundEmailDate, key: "daysSinceLastEmail" },
  ];
  const channelDays: Record<string, number | null> = {};
  for (const { src, key } of channelFields) {
    const dt = parseTimestamp(src);
    channelDays[key] = dt ? businessDaysSince(dt, now) : null;
  }

  return {
    needsReply:
      (convo.unreadCount || 0) > 0 && convo.lastMessageDirection === "inbound",
    lastMessageType: convo.lastMessageType || null,
    hasManualOutreach: convo.lastOutboundMessageAction === "manual",
    daysSinceLastContact: daysSince,
    daysSinceLastCall: channelDays.daysSinceLastCall,
    daysSinceLastSms: channelDays.daysSinceLastSms,
    daysSinceLastEmail: channelDays.daysSinceLastEmail,
    outboundCount: convo.outboundCount || 0,
    noConversation: false,
    conversationId: convo.conversationId || null,
    notes: convo.notes || [],
    conversationHistory: convo.messages || [],
  };
}

type ActionResult = [string, string, string]; // [action, priority, hint]

function decideAction(lead: EnrichedLead): ActionResult {
  const stage = lead.stage || "";
  const needsReply = lead.needsReply;
  const hasManual = lead.hasManualOutreach;
  const outboundCount = lead.outboundCount || 0;

  let bdays = lead.daysSinceLastContact;
  if (bdays === null) {
    bdays = approxBusinessDays(lead.days_in_stage);
  }

  // 1. Needs reply — inbound message waiting
  if (needsReply) return ["reply", "high", "Inbound message waiting — reply needed"];

  // 2. New Lead or no manual outreach — first contact needed
  if (stage === "New Lead" || !hasManual) {
    const label = stage === "New Lead" ? "New lead" : "No manual outreach yet";
    return ["outreach", "high", `${label} — send text + email`];
  }

  // 3. New Lead / In Progress — fixed follow-up cadence
  if (stage === "In Progress") {
    if (bdays >= 8 && outboundCount >= 3)
      return ["move", "info", `${bdays} bdays, ${outboundCount} attempts, no response — recommend Cooled Off`];
    if (bdays >= 5)
      return ["follow_up", "medium", `${bdays} bdays no response, ${outboundCount} attempts — text + call + email`];
    if (bdays >= 2)
      return ["follow_up", "medium", `${bdays} bdays no response — text + call + email`];
    return ["none", "none", "Contacted recently, waiting for response"];
  }

  // 4. Quote Sent / Invoice Sent — Claude decides based on conversation context
  if (stage === "Quote Sent" || stage === "Invoice Sent") {
    return ["follow_up", "medium", `${stage} — ${bdays} bdays since last contact, ${outboundCount} outbound messages. Claude to decide action and priority based on conversation context.`];
  }

  // 5. Default — active stage, needs follow-up
  return ["follow_up", "medium", `${stage} — ${bdays} bdays since last contact`];
}

function applyCooldown(lead: EnrichedLead, action: string, priority: string, hint: string): ActionResult {
  if (COOLDOWN_BYPASS_ACTIONS.has(action)) return [action, priority, hint];

  const bdays = lead.daysSinceLastContact;
  if (bdays !== null && bdays < COOLDOWN_DAYS) {
    return ["none", "none", `Cooldown: contacted ${bdays} bday(s) ago, waiting for response`];
  }

  return [action, priority, hint];
}

export function enrichLeads(
  leads: ParsedLead[],
  conversations: Record<string, ConversationMeta | null>,
): EnrichedLead[] {
  return leads.map((lead) => {
    const oppFields = enrichFromOpportunity(lead);
    const convo = conversations[lead.contactId] || null;
    const convoFields = enrichFromConversation(convo);

    const enriched: EnrichedLead = {
      ...lead,
      ...oppFields,
      ...convoFields,
    } as EnrichedLead;

    let [action, priority, hint] = decideAction(enriched);
    [action, priority, hint] = applyCooldown(enriched, action, priority, hint);

    enriched.reactivated = isReactivated(enriched.notes);

    // Reactivated leads must not be suppressed by cooldown
    if (enriched.reactivated && action === "none") {
      action = "outreach";
      priority = "high";
      hint = "Reactivated from Cooled Off — re-engagement outreach needed";
    }

    enriched.suggestedAction = action;
    enriched.suggestedPriority = priority;
    enriched.hint = hint;

    return enriched;
  });
}
