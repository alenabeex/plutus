import { NextRequest, NextResponse } from "next/server";

// Backstop to the 127.0.0.1 bind (package.json dev/start): even if the
// process is ever started unbound, refuse any non-localhost request.

const DEV = process.env.NODE_ENV !== "production";

// CSP: self-only, with the exact allowances Plaid Link needs (its script and
// iframe load from cdn.plaid.com). Next.js dev tooling needs unsafe-eval —
// dev only, never in production.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.plaid.com",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.plaid.com https://production.plaid.com https://sandbox.plaid.com",
  "frame-src https://cdn.plaid.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default function proxy(req: NextRequest) {
  const host = req.headers.get("host")?.split(":")[0] ?? "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    return new NextResponse("Forbidden — local access only", { status: 403 });
  }

  // CSRF backstop: state-changing requests must originate from the app
  // itself. Require a localhost Origin on every mutating request — a MISSING
  // Origin is rejected too (audit P1: don't let no-Origin requests through).
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = req.headers.get("origin");
    const oHost = origin
      ? (() => { try { return new URL(origin).hostname; } catch { return ""; } })()
      : "";
    if (oHost !== "127.0.0.1" && oHost !== "localhost") {
      return new NextResponse("Forbidden — cross-origin write blocked", { status: 403 });
    }
  }

  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return res;
}

export const config = { matcher: "/:path*" };
