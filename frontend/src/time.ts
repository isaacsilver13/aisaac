const centralFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** A relative label for activity under a day old, otherwise the full Central timestamp. */
export function humanizeTimestamp(value: string, now = new Date()): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Unknown time";

  const elapsedMs = now.getTime() - timestamp.getTime();
  const elapsedMinutes = Math.round(Math.abs(elapsedMs) / 60_000);
  const suffix = elapsedMs >= 0 ? "ago" : "from now";

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ${suffix}`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ${suffix}`;
  return centralTimestamp(value);
}

export const exactTimestamp = (value: string) => centralTimestamp(value);

/** Every displayed date-time: yyyy/mm/dd HH:mm:ss, 24h, America/Chicago. */
export function centralTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;

  const p = Object.fromEntries(centralFormatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Nullable variant for table cells: "—" when there is no timestamp. */
export const centralTimestampOrDash = (value: string | null | undefined) => (value ? centralTimestamp(value) : "—");
