import { NextRequest, NextResponse } from "next/server";
import {
  pinIsSet,
  sessionValid,
  setPin,
  verifyPin,
  issueSession,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: "status" | "set" | "unlock"; pin?: string };

  if (body.action === "status") {
    return NextResponse.json({ set: pinIsSet(), unlocked: sessionValid(req) });
  }

  if (body.action === "set") {
    if (pinIsSet()) {
      return NextResponse.json({ ok: false, error: "PIN already set" }, { status: 400 });
    }
    if (!body.pin || !/^\d{6}$/.test(body.pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be exactly 6 digits" }, { status: 400 });
    }
    try {
      setPin(body.pin);
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
    }
    const res = NextResponse.json({ ok: true });
    issueSession(res);
    return res;
  }

  if (body.action === "unlock") {
    if (!body.pin) {
      return NextResponse.json({ ok: false, error: "PIN required" }, { status: 400 });
    }
    const result = verifyPin(body.pin);
    if (!result.ok) {
      return NextResponse.json({ ok: false, retryInMs: result.retryInMs });
    }
    const res = NextResponse.json({ ok: true });
    issueSession(res);
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
