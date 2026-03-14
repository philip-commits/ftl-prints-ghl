import { NextResponse } from "next/server";

// Build-time constant — changes on every deployment
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || Date.now().toString();

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ version: BUILD_ID });
}
