export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-01-31T09:30" in the site timezone -> UTC ISO string (null if invalid). */
export function localToUtc(local: string, tz: string): string | null {
  const naive = Date.parse(local.slice(0, 16) + ':00Z');
  if (Number.isNaN(naive)) return null;
  let t = naive - offsetMs(new Date(naive), tz);
  t = naive - offsetMs(new Date(t), tz); // second pass settles DST edges
  return new Date(t).toISOString();
}

/** UTC ISO string -> value for <input type="datetime-local"> in the site timezone. */
export function utcToLocal(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + offsetMs(d, tz)).toISOString().slice(0, 16);
}

export function formatDate(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: tz }).format(d);
}
