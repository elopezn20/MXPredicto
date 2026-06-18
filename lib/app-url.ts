export function getAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  // Tolerate a scheme-less value (e.g. "mxpredicto.com"): assume https rather
  // than letting URL() throw and silently collapsing to the localhost fallback,
  // which would point production auth redirects at the wrong origin.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "http://localhost:3000";
  }
}
