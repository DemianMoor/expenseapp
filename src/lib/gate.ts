// Shared helpers for the optional password gate. Edge-safe (uses Web Crypto,
// available in both the Edge middleware runtime and Node).

export const AUTH_COOKIE = "em_auth";

/** Deterministic cookie token derived from the app password (never store it raw). */
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode("expensemap:" + password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
