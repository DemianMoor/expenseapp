import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/gate";

// Protect pages only. API routes enforce auth themselves (see lib/require-auth)
// so their compressed responses never pass through middleware (which can corrupt
// the Content-Encoding of large gzip/br bodies).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api).*)"],
};

export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next(); // gate disabled (e.g. local dev)

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await authToken(pw))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
