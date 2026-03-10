import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedLead, ActionItem, NoActionItem } from "../ghl/types";

const client = new Anthropic();

const MAX_CONCURRENT = 2;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 30_000; // 30s base delay for rate limits

const SYSTEM_PROMPT = `You are the daily operations assistant for Fort Lauderdale Screen Printing (FTL Prints), a South Florida custom apparel shop (screen printing, embroidery, DTG, heat transfers, finishing). You analyze one lead at a time and return a JSON action recommendation for Philip Munroe, the founder.

To quote a job, Philip needs: artwork/design, quantity, sizes/breakdown, garment type, and turnaround.

## DECISION HIERARCHY — first matching rule wins

Read the conversation history and notes, then apply these rules IN ORDER. Stop at the first match.

### 1. NEEDS REPLY (high priority)
If needsReply=true (unread inbound message) → return action: "reply". Answer their question and ask for whatever info is still missing.

### 2. BALL IN THEIR COURT — HARD OVERRIDE (never noAction)
If the customer's last message indicates they're pausing or deciding, you MUST return an action. This overrides cooldown, suggestedAction="none", and everything else.

**a) Soft no / postponed** — "not right now," "postpone," "timeline shifted," "will circle back when ready," "not in the budget," "maybe later":
→ MUST return: {"action": {"actionType": "move", "targetStageId": "7ec748b8-920d-4bdb-bf09-74dd22d27846", "priority": "info", ...}}
→ recommendation MUST mention: "Create a 'Follow up' task for 30-60 days out"
→ Do NOT return noAction. A postponement requires moving to Cooled Off.

**b) Still deciding / short delay** — "checking with my team," "need a head count," "waiting on approval," "let me confirm sizes":
→ MUST return: {"action": {"actionType": "follow_up", "priority": "medium", ...}}
→ recommendation: follow up in a few days to a week if no response
→ Do NOT return noAction. Do NOT move to Cooled Off — they're still interested.

### 3. ALREADY PAID / ORDER PLACED
If conversation shows payment or order confirmation → return action: "move" to Sale (1ab155c2-282d-45eb-bd43-1052489eb2a1).

### 4. CANCELED / OUT OF SCOPE
If customer explicitly canceled, went with someone else, or project is out of scope → return action: "move" to Cooled Off or Unqualified.

### 5. NO CONTACT INFO
If lead has no email AND no phone → return noAction with reason.

### 6. FOLLOW-UP DATE IN NOTES
If notes specify a future follow-up date that hasn't arrived yet → return noAction until that date.

### 7. NEEDS FIRST OUTREACH
If stage is New Lead OR hasManualOutreach=false (automated welcome messages don't count) → return action: "outreach" (high). Always include both SMS + email. Add call fields if the lead mentions urgency.

### 8. WRONG STAGE — recommend move
Check if the lead's stage matches the conversation:
- Quote/pricing was sent but stage is New Lead or In Progress → recommend move to Quote Sent (336a5bee-cad2-400f-83fd-cae1bc837029)
- Customer accepted quote but stage isn't Invoice Sent → recommend move to Invoice Sent (259ee5f4-5667-4797-948e-f36ec28c70a0)
- New Lead with outbound messages → auto-move to In Progress may have failed, mention it
- Unqualified signals (budget "$0-$149" AND quantity 1-2 items) → mention in recommendation

### 9. COOLDOWN — contacted recently
If suggestedAction="none" with a cooldown hint AND none of the above rules matched → return noAction. The lead was just contacted and needs time to respond.

### 10. STAGE-SPECIFIC FOLLOW-UP
If none of the above matched, follow the stage strategy:

**In Progress** (fixed cadence if no response):
- Day 2: Text + Call + Email
- Day 5: Text + Call + Email
- Day 8: Final call → if no answer, recommend Cooled Off
- If lead IS responding, follow the conversation naturally instead

**Quote Sent** (you decide channel based on conversation):
- Reference specific quote details (price, quantity, turnaround)
- Create urgency through timeline/availability if going cold
- Use the channel they've been most responsive on

**Invoice Sent** (you decide):
- Friendly payment reminders, not aggressive
- If no response after several attempts, ask Philip: "Has this been paid?"

## WRITING THE OUTPUT

Return valid JSON with EITHER {"action": {...}} or {"noAction": {...}}.

### Action fields:
- **actionType**: reply | outreach | call | follow_up | move
- **priority**: high (needs reply, new lead, urgency, buying signals) | medium (routine follow-ups) | info (stage moves, going cold)
- **label**: Short, specific (e.g., "Reply to sizing question" not "Follow up with lead")
- **context**: ~250 chars grounded in conversation — reference specific prices, products, quantities, what was discussed. NEVER generic filler.
- **recommendation**: ~150 chars — the specific next step for Philip

### Draft messages (REQUIRED for all actions except "move"):
Every action must include ready-to-send drafts for all recommended channels.

**Email** (always include for domestic + international):
- subject: Specific subject line referencing their project
- message: 3-5 sentences. Professional but warm, South Florida casual. Reference conversation details. Sign as "Philip" (existing) or "The FTL Prints Team" (first contact).

**SMS** (always include for domestic, NEVER for international):
- smsMessage: Under 160 chars. Casual, reference something specific. Sign "—Phil"

**Call** (include when calling is recommended, NEVER for international):
- noAnswerSms: Under 160 chars ("Hey [name], tried calling about [specific thing]. —Phil")
- noAnswerSubject: Email subject for no-answer follow-up
- noAnswerEmail: 2-3 sentence email for no-answer follow-up

**Move**:
- targetStageId: The stage ID to move to

### Channel rules:
- International (isInternational=true): EMAIL ONLY
- New Lead first contact: always text + email
- In Progress no response: text + call + email
- Quote Sent / Invoice Sent: use whatever channel they respond on
- Repeat/existing customers: warmer tone, reference past orders

### noAction fields:
- **reason**: Clear, specific reason (not just "no action needed")

## HARD RULES
- NEVER offer to adjust, reduce, or discount pricing
- NEVER draft a message without referencing a specific conversation detail
- NEVER suggest contacting someone contacted today with no response yet
- Use today's date (provided in user message) for all time reasoning

## STAGE IDs
- Quote Sent: 336a5bee-cad2-400f-83fd-cae1bc837029
- Invoice Sent: 259ee5f4-5667-4797-948e-f36ec28c70a0
- Sale: 1ab155c2-282d-45eb-bd43-1052489eb2a1
- Cooled Off: 7ec748b8-920d-4bdb-bf09-74dd22d27846
- Unqualified: b909061c-9141-45d7-b1e2-fd37432c3596

Output valid JSON only.`;

async function generateForLead(
  lead: EnrichedLead,
  inactiveSummary: Record<string, number>,
): Promise<{ action?: Partial<ActionItem>; noAction?: Partial<NoActionItem> }> {
  const leadData = {
    contactName: lead.name,
    contactEmail: lead.email,
    contactPhone: lead.phone,
    stage: lead.stage,
    monetaryValue: lead.monetaryValue,
    source: lead.source,
    days_created: lead.days_created,
    days_in_stage: lead.days_in_stage,
    service_type: lead.service_type,
    budget: lead.budget,
    quantity: lead.quantity,
    sizes: lead.sizes,
    project_details: lead.project_details,
    hasArtwork: lead.hasArtwork,
    waitingOnArtwork: lead.waitingOnArtwork,
    isInternational: lead.isInternational,
    missingInfo: lead.missingInfo,
    needsReply: lead.needsReply,
    hasManualOutreach: lead.hasManualOutreach,
    daysSinceLastContact: lead.daysSinceLastContact,
    daysSinceLastCall: lead.daysSinceLastCall,
    daysSinceLastSms: lead.daysSinceLastSms,
    daysSinceLastEmail: lead.daysSinceLastEmail,
    outboundCount: lead.outboundCount,
    noConversation: lead.noConversation,
    suggestedAction: lead.suggestedAction,
    suggestedPriority: lead.suggestedPriority,
    hint: lead.hint,
    conversationHistory: lead.conversationHistory,
    notes: lead.notes,
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today's date: ${today}

Pipeline summary (inactive stages, for context only):
${JSON.stringify(inactiveSummary)}

Analyze this lead and generate a recommendation:
${JSON.stringify(leadData, null, 2)}

Return JSON with either {"action": {...}} or {"noAction": {...}}`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[recommendations] No JSON in response for ${lead.name}, treating as noAction`);
    return { noAction: { reason: "Failed to generate recommendation" } };
  }

  return JSON.parse(jsonMatch[0]);
}

export async function generateRecommendations(
  leads: EnrichedLead[],
  inactiveSummary: Record<string, number>,
): Promise<{ actions: ActionItem[]; noAction: NoActionItem[] }> {
  const actions: ActionItem[] = [];
  const noAction: NoActionItem[] = [];

  // Process leads with concurrency limit
  const queue = [...leads];
  const results: Array<{ lead: EnrichedLead; result: { action?: Partial<ActionItem>; noAction?: Partial<NoActionItem> } }> = [];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const lead = queue.shift()!;
      console.log(`[recommendations] Analyzing ${lead.name} (${lead.stage})...`);
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await generateForLead(lead, inactiveSummary);
          results.push({ lead, result });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const isRateLimit = err instanceof Error && (err.message.includes("429") || err.message.includes("rate_limit"));
          if (isRateLimit && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_DELAY_MS * (attempt + 1);
            console.warn(`[recommendations] Rate limited for ${lead.name}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            break;
          }
        }
      }
      if (lastErr) {
        console.warn(`[recommendations] Error for ${lead.name}:`, lastErr);
        results.push({
          lead,
          result: { noAction: { reason: "Error generating recommendation" } },
        });
      }
    }
  }

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT, leads.length); i++) {
    workers.push(processNext());
  }
  await Promise.all(workers);

  // Assemble results — assign sequential IDs and attach lead metadata
  let id = 1;
  for (const { lead, result } of results) {
    if (result.action) {
      const action = result.action as ActionItem;
      action.id = id++;
      action.contactId = lead.contactId;
      action.contactName = lead.name;
      action.contactEmail = lead.email;
      action.contactPhone = lead.phone;
      action.opportunityId = lead.id;
      action.stage = lead.stage;
      action.conversationHistory = lead.conversationHistory;
      action.notes = lead.notes;
      action.international = lead.isInternational;
      actions.push(action);
    } else if (result.noAction) {
      const item = result.noAction as NoActionItem;
      item.contactName = lead.name;
      item.stage = lead.stage;
      item.opportunityId = lead.id;
      noAction.push(item);
    }
  }

  return { actions, noAction };
}
