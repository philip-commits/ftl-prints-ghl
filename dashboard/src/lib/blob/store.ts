import { put, head } from "@vercel/blob";
import type { DashboardData, SentStatus } from "../ghl/types";

const DASHBOARD_KEY = "dashboard-data.json";
const SENT_STATUS_KEY = "sent-status.json";

export async function readDashboardData(): Promise<DashboardData | null> {
  try {
    const blob = await head(DASHBOARD_KEY);
    const resp = await fetch(blob.url, { cache: "no-store" });
    return (await resp.json()) as DashboardData;
  } catch (e) {
    console.error("[readDashboardData] error:", e);
    return null;
  }
}

export async function writeDashboardData(data: DashboardData): Promise<void> {
  await put(DASHBOARD_KEY, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}

export async function readSentStatus(): Promise<SentStatus> {
  try {
    const blob = await head(SENT_STATUS_KEY);
    const resp = await fetch(blob.url, { cache: "no-store" });
    return (await resp.json()) as SentStatus;
  } catch {
    return {};
  }
}

export async function writeSentStatus(status: SentStatus): Promise<void> {
  await put(SENT_STATUS_KEY, JSON.stringify(status), {
    access: "public",
    addRandomSuffix: false,
  });
}
