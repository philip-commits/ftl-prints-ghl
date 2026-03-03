import { fetchOpportunities } from "@/lib/ghl/pipeline";
import { fetchAllConversations } from "@/lib/ghl/conversations";
import { enrichLeads } from "@/lib/ghl/enrich";
import { generateRecommendations } from "@/lib/claude/recommendations";
import { readDashboardData, writeDashboardData } from "@/lib/blob/store";

async function main() {
  const start = Date.now();
  console.log("[watcher] Checking for new leads...");

  // Step 1: Read existing dashboard data — bail if daily hasn't run yet
  const existing = await readDashboardData();
  if (!existing) {
    console.log("[watcher] No existing dashboard data — daily pipeline hasn't run yet. Exiting.");
    return;
  }

  // Step 2: Collect known opportunity IDs
  const knownIds = new Set<string>();
  for (const a of existing.actions) {
    if (a.opportunityId) knownIds.add(a.opportunityId);
  }
  for (const n of existing.noAction) {
    if (n.opportunityId) knownIds.add(n.opportunityId);
  }
  console.log(`[watcher] ${knownIds.size} known opportunity IDs`);

  // Step 3: Fetch current opportunities from GHL
  const { active, inactiveSummary } = await fetchOpportunities();
  console.log(`[watcher] ${active.length} active leads in GHL`);

  // Step 4: Filter to only new leads
  const newLeads = active.filter((lead) => !knownIds.has(lead.id));
  if (newLeads.length === 0) {
    console.log("[watcher] No new leads found. Exiting.");
    return;
  }
  console.log(`[watcher] ${newLeads.length} new lead(s) detected: ${newLeads.map((l) => l.name).join(", ")}`);

  // Step 5: Run pipeline on new leads only
  console.log("[watcher] Fetching conversations...");
  const conversations = await fetchAllConversations(newLeads);

  console.log("[watcher] Enriching leads...");
  const enriched = enrichLeads(newLeads, conversations);

  console.log("[watcher] Generating recommendations...");
  const { actions: newActions, noAction: newNoAction } = await generateRecommendations(
    enriched,
    inactiveSummary,
  );
  console.log(`[watcher] ${newActions.length} actions, ${newNoAction.length} no-action`);

  // Step 6: Re-ID new actions starting after the existing max ID
  const maxId = existing.actions.reduce((max, a) => Math.max(max, a.id), 0);
  for (let i = 0; i < newActions.length; i++) {
    newActions[i].id = maxId + 1 + i;
  }

  // Step 7: Merge into existing data
  const merged = {
    actions: [...existing.actions, ...newActions],
    noAction: [...existing.noAction, ...newNoAction],
    inactiveSummary, // fresh from GHL (most accurate)
    generatedAt: new Date().toISOString(),
  };

  console.log("[watcher] Writing merged dashboard data...");
  await writeDashboardData(merged);
  // NOTE: Do NOT reset sent-status.json — preserve existing sent/dismissed state

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[watcher] Done in ${elapsed}s — added ${newActions.length + newNoAction.length} items`);
}

main().catch((err) => {
  console.error("[watcher] Fatal error:", err);
  process.exit(1);
});
