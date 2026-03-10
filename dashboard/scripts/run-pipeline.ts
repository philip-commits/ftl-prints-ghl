import { fetchOpportunities, reactivateCooledOffLeads, autoMoveNewLeads } from "@/lib/ghl/pipeline";
import { fetchAllConversations } from "@/lib/ghl/conversations";
import { enrichLeads } from "@/lib/ghl/enrich";
import { generateRecommendations } from "@/lib/claude/recommendations";
import { writeDashboardData, writeSentStatus } from "@/lib/blob/store";

async function main() {
  const start = Date.now();
  console.log("[pipeline] Starting daily pipeline...");

  // Step 0: Reactivate Cooled Off leads with upcoming tasks
  console.log("[pipeline] Checking Cooled Off leads for upcoming tasks...");
  const reactivated = await reactivateCooledOffLeads();
  if (reactivated > 0) console.log(`[pipeline] Reactivated ${reactivated} lead(s) from Cooled Off`);

  // Step 1: Fetch opportunities (reactivated leads are now In Progress)
  console.log("[pipeline] Fetching opportunities...");
  const { active, inactiveSummary } = await fetchOpportunities();
  console.log(`[pipeline] Found ${active.length} active leads`);

  // Step 2: Fetch conversations
  console.log("[pipeline] Fetching conversations...");
  const conversations = await fetchAllConversations(active);
  const withConvos = Object.values(conversations).filter(Boolean).length;
  console.log(`[pipeline] ${withConvos}/${active.length} have conversations`);

  // Step 3: Enrich leads
  console.log("[pipeline] Enriching leads...");
  const enriched = enrichLeads(active, conversations);
  console.log(`[pipeline] Enriched ${enriched.length} leads`);

  // Step 3b: Auto-move New Leads that already have manual outreach
  const moved = await autoMoveNewLeads(enriched);
  if (moved > 0) console.log(`[pipeline] Auto-moved ${moved} lead(s) to In Progress`);

  // Step 4: Generate recommendations
  console.log("[pipeline] Generating recommendations...");
  const { actions, noAction } = await generateRecommendations(
    enriched,
    inactiveSummary,
  );
  console.log(
    `[pipeline] ${actions.length} actions, ${noAction.length} no-action`,
  );

  // Step 5: Write dashboard data
  console.log("[pipeline] Writing dashboard data...");
  await writeDashboardData({
    actions,
    noAction,
    inactiveSummary,
    generatedAt: new Date().toISOString(),
  });

  // Step 6: Reset sent status
  await writeSentStatus({});

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[pipeline] Done in ${elapsed}s`);
}

main().catch((err) => {
  console.error("[pipeline] Fatal error:", err);
  process.exit(1);
});
