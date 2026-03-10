import { NextResponse } from "next/server";
import { readDashboardData } from "@/lib/blob/store";
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

  const { title, dueDate } = await request.json();

  if (!title) {
    return NextResponse.json({ success: false, error: "Title is required" }, { status: 400 });
  }

  try {
    await ghlFetch({
      path: `/contacts/${action.contactId}/tasks`,
      method: "POST",
      body: {
        title,
        dueDate: dueDate || new Date(Date.now() + 7 * 86400000).toISOString(),
        completed: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
