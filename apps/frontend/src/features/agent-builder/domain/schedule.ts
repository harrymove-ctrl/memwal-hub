const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Validates a 5-field cron with the subset the editor supports. Returns an error or null. */
export function validateCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Use 5 fields: minute hour day-of-month month day-of-week.";
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < 5; i++) {
    const p = parts[i];
    if (p === "*") continue;
    for (const piece of p.split(",")) {
      const m = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(piece) ?? /^\*\/(\d+)$/.exec(piece);
      if (!m) return `Field ${i + 1} (“${p}”) is not valid.`;
      const nums = m.slice(1).filter(Boolean).map(Number);
      if (piece.startsWith("*/")) continue;
      const [lo, hi] = ranges[i];
      if (nums.slice(0, 2).some((n) => n < lo || n > hi)) return `Field ${i + 1} must be between ${lo} and ${hi}.`;
    }
  }
  return null;
}

/**
 * Human label for simple weekly/daily crons ("Mon 08:00 AM"). Times are shown
 * exactly as written in the schedule's own timezone — never converted to the
 * viewer's zone.
 */
export function describeCron(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (!/^\d+$/.test(min ?? "") || !/^\d+$/.test(hour ?? "") || dom !== "*" || mon !== "*") return cron;
  const h = Number(hour), m = Number(min);
  const time = `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  if (dow === "*") return `Daily ${time}`;
  if (/^\d$/.test(dow)) return `${DAYS[Number(dow) % 7]} ${time}`;
  return `${time} · days ${dow}`;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Short zone label for the schedule's own timezone at a given instant (CEST, EDT).
 * ICU only knows abbreviations per locale (en-US: American zones, en-GB: European),
 * so try both and fall back to the GMT offset form.
 */
export function zoneAbbrev(tz: string, at = new Date()): string {
  let fallback = tz;
  for (const locale of ["en-US", "en-GB"]) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value;
      if (!name) continue;
      if (!/^(GMT|UTC)[+-]/.test(name)) return name;
      fallback = name;
    } catch {
      return tz;
    }
  }
  return fallback;
}
