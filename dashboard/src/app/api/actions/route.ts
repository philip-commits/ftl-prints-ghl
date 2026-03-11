import { NextResponse } from "next/server";
import { readDashboardData } from "@/lib/blob/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readDashboardData();
  if (!data) {
    return NextResponse.json(
      { actions: [], noAction: [], inactiveSummary: {}, generatedAt: null },
    );
  }
  return NextResponse.json(data);
}
