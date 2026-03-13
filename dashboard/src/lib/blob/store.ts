import { put, head } from "@vercel/blob";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { DashboardData, SentStatus } from "../ghl/types";

const DASHBOARD_KEY = "dashboard-data.json";
const SENT_STATUS_KEY = "sent-status.json";
const LOCAL_DATA_PATH = resolve(process.cwd(), "public/local-dashboard-data.json");

export async function readDashboardData(): Promise<DashboardData | null> {
  // In dev, prefer local file if it exists
  if (process.env.NODE_ENV === "development" && existsSync(LOCAL_DATA_PATH)) {
    try {
      const raw = readFileSync(LOCAL_DATA_PATH, "utf-8");
      console.log("[readDashboardData] Using local file");
      return JSON.parse(raw) as DashboardData;
    } catch (e) {
      console.error("[readDashboardData] local file error:", e);
    }
  }

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
