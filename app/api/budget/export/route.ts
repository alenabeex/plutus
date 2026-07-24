import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked } from "@/lib/auth";
import { exportMonthXlsx } from "@/lib/sheet-io";
import { monthLabel } from "@/lib/format";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const month = new URL(req.url).searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month required (YYYY-MM)" }, { status: 400 });
  }

  try {
    const buf = exportMonthXlsx(month);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cash-flow ${monthLabel(month)}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("budget export failed:", e);
    return NextResponse.json({ error: "export-failed" }, { status: 404 });
  }
}
