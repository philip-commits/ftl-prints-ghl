import { NextResponse } from "next/server";
import { readDashboardData } from "@/lib/blob/store";
import { readSentStatus, writeSentStatus } from "@/lib/blob/store";
import { ghlFetch } from "@/lib/ghl/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actionId = parseInt(id, 10);

  const data = await readDashboardData();
  if (!data) {
    return NextResponse.json({ success: false, error: "No dashboard data" }, { status: 404 });
  }

  const action = data.actions.find((a) => a.id === actionId);
  if (!action) {
    return NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });
  }

  let targetStageId: string;
  try {
    const reqBody = await request.json();
    targetStageId = reqBody.targetStageId || action.targetStageId || "";
  } catch {
    targetStageId = action.targetStageId || "";
  }

  if (!targetStageId) {
    return NextResponse.json({ success: false, error: "No target stage specified" }, { status: 400 });
  }

  try {
    await ghlFetch({
      path: `/opportunities/${action.opportunityId}`,
      method: "PUT",
      body: { pipelineStageId: targetStageId },
    });

    const sent = await readSentStatus();
    sent[`${id}_move`] = { status: `moved:${targetStageId}`, ts: Date.now() };
    await writeSentStatus(sent);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
