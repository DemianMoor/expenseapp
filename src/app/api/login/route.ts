import { NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/login { password } -> sets the auth cookie when it matches APP_PASSWORD. */
export async function POST(req: Request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    return NextResponse.json({ error: "Password gate is not configured." }, { status: 400 });
  }
  let password = "";
  try {
    const body = await req.json();
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    // ignore malformed body
  }
  if (password !== pw) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(pw), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
