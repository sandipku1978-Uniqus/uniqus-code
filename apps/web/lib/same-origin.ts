/** State-changing route handlers require a browser POST from their own origin. */
export function isSameOriginPost(req: Request): boolean {
  if (req.method !== "POST") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}
