import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return NextResponse.json({ error: "Fetch failed" }, { status: resp.status });
    }

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const blob = await resp.arrayBuffer();

    // Try to derive a filename from the URL or content-disposition
    const cdHeader = resp.headers.get("content-disposition");
    let filename = "attachment";
    if (cdHeader) {
      const match = cdHeader.match(/filename="?([^";\n]+)"?/);
      if (match) filename = match[1];
    } else {
      const urlPart = url.split("/").pop()?.split("?")[0];
      if (urlPart) filename = urlPart;
    }

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
