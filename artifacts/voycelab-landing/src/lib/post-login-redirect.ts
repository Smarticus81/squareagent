/**
 * Preserves the page a logged-out user was trying to reach so login can land
 * them there instead of always dumping them on /assistants.
 */
const KEY = "voycelab.post_login_redirect";

/** Call from a gated page right before bouncing to /login. */
export function rememberIntendedPath(): void {
  try {
    const path = `${window.location.pathname}${window.location.search}`;
    // Never loop back into auth pages.
    if (path.startsWith("/login") || path.startsWith("/signup")) return;
    sessionStorage.setItem(KEY, path);
  } catch {
    // sessionStorage unavailable — fall back to the default destination
  }
}

/** Call on login success. Returns the stored path once, or null. */
export function consumeIntendedPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
