const RETURN_PATH_STORAGE_KEY = "memwal:return_path";

/** True when any character is a C0 control character or DEL (checked by code point, not by regex). */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validates that a string is a safe, same-origin relative path starting with a single '/'.
 *
 * Rejects:
 * - Protocol-relative URLs ('//evil.com')
 * - Absolute URLs with schemes ('https://x', 'http://x', 'javascript:', 'data:')
 * - Paths containing backslashes ('/\evil', '/\\evil')
 * - Encoded variants (%2f%2f, %5c)
 * - Empty, non-string, or malformed inputs
 */
export function validateReturnPath(path: unknown): string | null {
  if (typeof path !== "string") {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  // Must start with exactly one '/' and not '//' or '/\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return null;
  }

  // Reject any backslashes anywhere in the path
  if (trimmed.includes("\\")) {
    return null;
  }

  // Reject control characters or newlines
  if (hasControlCharacter(trimmed)) {
    return null;
  }

  // Check URL-decoded versions to catch encoded schemes, protocol-relative '//', or backslashes
  let decoded = trimmed;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      // Malformed encoding sequence
      return null;
    }
  }

  // After decoding, ensure it still starts with a single '/' and has no '//', control characters or backslashes
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.startsWith("/\\") ||
    hasControlCharacter(decoded)
  ) {
    return null;
  }
  // Reject schemes in the path part before query/hash (e.g. /javascript:...)
  const pathPart = decoded.split(/[?#]/, 1)[0];
  if (pathPart.includes(":")) {
    return null;
  }

  // Validate against URL parser with a dummy base to ensure it remains same-origin
  try {
    const dummyBase = "https://memwal.local";
    const parsed = new URL(trimmed, dummyBase);
    if (parsed.origin !== dummyBase) {
      return null;
    }
    if (parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  return trimmed;
}

export function getStoredReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_PATH_STORAGE_KEY);
    return validateReturnPath(raw);
  } catch {
    return null;
  }
}

export function setStoredReturnPath(path: string): void {
  if (typeof window === "undefined") return;
  const valid = validateReturnPath(path);
  if (!valid) return;
  try {
    window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, valid);
  } catch {
    // sessionStorage unavailable
  }
}

export function clearStoredReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RETURN_PATH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function resolveReturnPath(searchParams?: URLSearchParams): string | null {
  if (searchParams) {
    const fromParam =
      searchParams.get("returnTo") ??
      searchParams.get("return_url") ??
      searchParams.get("redirect");
    const validated = validateReturnPath(fromParam);
    if (validated) return validated;
  }
  return getStoredReturnPath();
}
