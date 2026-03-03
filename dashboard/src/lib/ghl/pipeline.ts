import { PIPELINE_ID, LOCATION_ID, ACTIVE_STAGES, INACTIVE_STAGES, CUSTOM_FIELDS, STAGE_IDS } from "../constants";
import { ghlFetch } from "./client";
import type { GHLOpportunity, ParsedLead, EnrichedLead } from "./types";

interface SearchResponse {
  opportunities?: GHLOpportunity[];
  data?: { opportunities?: GHLOpportunity[] };
}

export async function fetchOpportunities(): Promise<{
  active: ParsedLead[];
  inactiveSummary: Record<string, number>;
}> {
  const resp = await ghlFetch<SearchResponse>({
    path: `/opportunities/search?pipeline_id=${PIPELINE_ID}&location_id=${LOCATION_ID}&limit=100`,
  });

  const opportunities = resp.opportunities || resp.data?.opportunities || [];
  const now = Date.now();
  const active: ParsedLead[] = [];
  const inactiveSummary: Record<string, number> = {};

  for (const opp of opportunities) {
    const stageId = opp.pipelineStageId || "";
    const contact = opp.contact || {};
    const created = opp.createdAt || "";
    const stageChanged = opp.lastStageChangeAt || opp.lastStatusChangeAt || created;

    let daysCreated = 0;
    let daysInStage = 0;
    try {
      daysCreated = Math.floor((now - new Date(created).getTime()) / 86400000);
    } catch { /* ignore */ }
    try {
      daysInStage = Math.floor((now - new Date(stageChanged).getTime()) / 86400000);
    } catch { /* ignore */ }

    // Extract custom fields
    const cfields: Record<string, string | string[]> = {};
    for (const cf of opp.customFields || []) {
      const fieldName = CUSTOM_FIELDS[cf.id];
      if (!fieldName) continue;
      if (fieldName === "artwork") {
        const files = cf.fieldValueFiles || [];
        cfields[fieldName] = files.map((f) => f.url);
      } else {
        cfields[fieldName] = cf.fieldValueString || "";
      }
    }

    if (stageId in ACTIVE_STAGES) {
      active.push({
        id: opp.id,
        name: contact.name || "Unknown",
        email: contact.email || "",
        phone: contact.phone || "",
        contactId: contact.id || "",
        stage: ACTIVE_STAGES[stageId],
        stageId,
        source: opp.source || "",
        monetaryValue: opp.monetaryValue || 0,
        days_created: daysCreated,
        days_in_stage: daysInStage,
        ...(cfields as Record<string, string | string[] | undefined>),
      } as ParsedLead);
    } else if (stageId in INACTIVE_STAGES) {
      const stageName = INACTIVE_STAGES[stageId];
      inactiveSummary[stageName] = (inactiveSummary[stageName] || 0) + 1;
    }
  }

  return { active, inactiveSummary };
}

/**
 * Auto-move New Leads to In Progress if manual outreach already happened
 * (e.g., someone on the team messaged them directly in GHL).
 * Mutates the enriched lead's stage/stageId in place so downstream
 * processing sees the correct stage.
 */
export async function autoMoveNewLeads(leads: EnrichedLead[]): Promise<number> {
  const inProgressId = STAGE_IDS["In Progress"];
  let moved = 0;

  for (const lead of leads) {
    if (lead.stage !== "New Lead" || !lead.hasManualOutreach) continue;

    try {
      await ghlFetch({
        path: `/opportunities/${lead.id}`,
        method: "PUT",
        body: { pipelineStageId: inProgressId },
      });
      lead.stage = "In Progress";
      lead.stageId = inProgressId;
      moved++;
      console.log(`[auto-move] ${lead.name}: New Lead → In Progress`);
    } catch (err) {
      console.warn(`[auto-move] Failed for ${lead.name}:`, err);
    }
  }

  return moved;
}
