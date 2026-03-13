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
    const effectiveDueDate = dueDate || new Date(Date.now() + 7 * 86400000).toISOString();

    // Check for existing task with same title and due date
    const existing = await ghlFetch<{ tasks: Array<{ title: string; dueDate: string; completed: boolean }> }>({
      path: `/contacts/${action.contactId}/tasks`,
    });
    const isDuplicate = (existing.tasks || []).some(
      (t) => t.title === title && t.dueDate === effectiveDueDate && !t.completed,
    );
    if (isDuplicate) {
      return NextResponse.json({ success: true, note: "Task already exists" });
    }

    await ghlFetch({
      path: `/contacts/${action.contactId}/tasks`,
      method: "POST",
      body: {
        title,
        dueDate: effectiveDueDate,
        completed: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
