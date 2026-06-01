import { AUTH_COOKIE, authToken } from "./gate";

/**
 * Auth check for API routes. We enforce it here (not in middleware) so the
 * compressed JSON responses from these routes never traverse the Edge
 * middleware — routing a gzip/br body through middleware can drop the
 * Content-Encoding header and corrupt the response. Returns true when the
 * request is allowed (correct cookie, or no APP_PASSWORD set = gate disabled).
 */
export async function isAuthed(req: Request): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true; // gate disabled (e.g. local dev)
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)em_auth=([^;]+)/);
  const val = m?.[1];
  return !!val && val === (await authToken(pw));
}
