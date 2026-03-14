import { LOCATION_ID, CHANNEL_MAP } from "../constants";
import { ghlFetch } from "./client";
import type { ConversationMeta, NoteEntry, MessageEntry, ParsedLead } from "./types";

function stripHtml(html: string): string {
  if (!html) return "";
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<div\s+class="gmail_quote[^"]*"[\s\S]*/gi, "")
    .replace(/<blockquote[^>]*>[\s\S]*/gi, "")
    .replace(/<[^>]+>/g, " ");
  // Trim "On <date> ... wrote:" trailing patterns
  cleaned = cleaned.split(/\s*On\s+\w{3},\s+\w{3}\s+\d/)[0];
  return cleaned.replace(/\s+/g, " ").trim();
}

async function fetchNotes(contactId: string): Promise<NoteEntry[]> {
  try {
    const data = await ghlFetch<{ notes?: Array<{ body?: string; dateAdded?: string }> }>({
      path: `/contacts/${contactId}/notes`,
    });
    const notes = (data.notes || [])
      .sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""))
      .map((n) => ({ body: n.body || "", dateAdded: n.dateAdded || "" }));
    return notes;
  } catch {
    return [];
  }
}

async function fetchEmailBody(messageId: string): Promise<string> {
  try {
    const data = await ghlFetch<{ message?: { body?: string }; body?: string }>({
      path: `/conversations/messages/${messageId}`,
    });
    const raw = data.message?.body || data.body || "";
    return raw ? stripHtml(raw) : "";
  } catch {
    return "";
  }
}

interface RawMessage {
  id?: string;
  direction?: string;
  messageType?: string;
  body?: string;
  message?: string;
  dateAdded?: string;
  createdAt?: string;
  meta?: Record<string, { direction?: string }>;
}

function getDirection(m: RawMessage): string | null {
  if (m.direction) return m.direction;
  if (m.meta) {
    for (const v of Object.values(m.meta)) {
      if (v && typeof v === "object" && "direction" in v) return v.direction || null;
    }
  }
  return null;
}

interface MessagesResult {
  outboundCount: number | null;
  channelDates: Record<string, string | number | null>;
  recentMessages: MessageEntry[];
}

async function fetchMessages(conversationId: string): Promise<MessagesResult> {
  try {
    const data = await ghlFetch<{
      messages?: RawMessage[] | { messages?: RawMessage[] };
      data?: RawMessage[];
    }>({
      path: `/conversations/${conversationId}/messages?limit=100`,
    });

    let messages: RawMessage[];
    const raw = data.messages || data.data || [];
    if (Array.isArray(raw)) {
      messages = raw;
    } else {
      messages = (raw as { messages?: RawMessage[] }).messages || [];
    }

    const count = messages.filter((m) => getDirection(m) === "outbound").length;

    const channelMap: Record<string, string> = {
      TYPE_CALL: "lastOutboundCallDate",
      TYPE_SMS: "lastOutboundSmsDate",
      TYPE_EMAIL: "lastOutboundEmailDate",
    };
    const channelDates: Record<string, string | number | null> = {
      lastOutboundCallDate: null,
      lastOutboundSmsDate: null,
      lastOutboundEmailDate: null,
    };

    for (const m of messages) {
      if (getDirection(m) !== "outbound") continue;
      const msgType = m.messageType || "";
      if (!(msgType in channelMap)) continue;
      const ts = m.dateAdded || m.createdAt;
      const key = channelMap[msgType];
      if (ts && (channelDates[key] === null || ts > channelDates[key]!)) {
        channelDates[key] = ts;
      }
    }

    // Extract recent messages with bodies
    const recentMessages: MessageEntry[] = [];
    let emailFetches = 0;

    for (const m of messages.slice(0, 20)) {
      const direction = getDirection(m) || "unknown";
      const msgType = m.messageType || "";
      const channel = CHANNEL_MAP[msgType] || msgType;
      const ts = m.dateAdded || m.createdAt || "";

      let text: string;
      if (msgType === "TYPE_CALL") {
        // Calls have no body — synthesize one so they appear in conversation history
        text = direction === "inbound" ? "[Inbound call]" : "[Outbound call]";
      } else if (msgType === "TYPE_EMAIL" && emailFetches < 10) {
        text = m.id ? await fetchEmailBody(m.id) : "";
        emailFetches++;
      } else {
        text = m.body || m.message || "";
      }

      if (text.length > 500) text = text.slice(0, 500) + "...";
      if (!text) continue;

      recentMessages.push({ direction, channel, body: text, date: ts });
    }

    return { outboundCount: count, channelDates, recentMessages };
  } catch {
    return { outboundCount: null, channelDates: {}, recentMessages: [] };
  }
}

async function fetchConversation(
  contactId: string,
  stage: string,
): Promise<ConversationMeta | null> {
  try {
    const data = await ghlFetch<{
      conversations?: Array<{
        id?: string;
        unreadCount?: number;
        lastMessageDirection?: string;
        lastMessageDate?: string | number;
        lastMessageType?: string;
        lastOutboundMessageAction?: string;
        lastManualMessageDate?: string;
      }>;
    }>({
      path: `/conversations/search?contactId=${contactId}&locationId=${LOCATION_ID}`,
    });

    const conversations = data.conversations || [];
    if (!conversations.length) {
      if (stage !== "New Lead") {
        const notes = await fetchNotes(contactId);
        if (notes.length) {
          return {
            unreadCount: 0,
            outboundCount: 0,
            notes,
            messages: [],
          };
        }
      }
      return null;
    }

    const convo = conversations[0];
    const convoId = convo.id;

    const { outboundCount, channelDates, recentMessages } = convoId
      ? await fetchMessages(convoId)
      : { outboundCount: null, channelDates: {}, recentMessages: [] };

    const notes = stage !== "New Lead" ? await fetchNotes(contactId) : [];

    return {
      unreadCount: convo.unreadCount || 0,
      lastMessageDirection: convo.lastMessageDirection,
      lastMessageDate: convo.lastMessageDate,
      lastMessageType: convo.lastMessageType,
      lastOutboundMessageAction: convo.lastOutboundMessageAction,
      lastManualMessageDate: convo.lastManualMessageDate,
      conversationId: convoId,
      outboundCount: outboundCount ?? 0,
      lastOutboundCallDate: channelDates.lastOutboundCallDate,
      lastOutboundSmsDate: channelDates.lastOutboundSmsDate,
      lastOutboundEmailDate: channelDates.lastOutboundEmailDate,
      notes,
      messages: recentMessages,
    };
  } catch {
    return null;
  }
}

export async function fetchAllConversations(
  leads: ParsedLead[],
): Promise<Record<string, ConversationMeta | null>> {
  const results: Record<string, ConversationMeta | null> = {};

  // Process in batches of MAX_CONCURRENT (semaphore in client handles rate limiting)
  const promises = leads
    .filter((l) => l.contactId)
    .map(async (lead) => {
      const meta = await fetchConversation(lead.contactId, lead.stage);
      results[lead.contactId] = meta;
    });

  await Promise.allSettled(promises);
  return results;
}
