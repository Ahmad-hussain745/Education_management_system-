const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthStart(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

// "September" with no year given is assumed to mean the most recent
// September that isn't in the future — so asking in October 2026 about
// "September" means Sep 2026, but asking in March 2026 means Sep 2025.
// This is a guess about what the person meant, same as any calendar app's
// "next Tuesday" — never a guess about the DATA itself, which is always
// then looked up for real.
function resolveNamedMonth(name, referenceDate) {
  const idx = MONTH_NAMES.indexOf(name.toLowerCase());
  if (idx === -1) return null;
  let year = referenceDate.getFullYear();
  if (idx > referenceDate.getMonth()) year -= 1;
  return monthStart(year, idx);
}

export function thisMonthStart(referenceDate = new Date()) {
  return monthStart(referenceDate.getFullYear(), referenceDate.getMonth());
}

export function lastMonthStart(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  d.setMonth(d.getMonth() - 1);
  return monthStart(d.getFullYear(), d.getMonth());
}

export function monthLabel(monthStr) {
  return new Date(monthStr + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Finds every month name mentioned, in the order they appear, resolved to
// YYYY-MM-01 — "compare September with August" → ["2026-09-01",
// "2026-08-01"]. Also understands "this month" / "last month" as
// stand-ins for a named month. Returns [] if nothing recognizable is
// found — callers treat that as "couldn't tell which month," not as
// "assume the current month," since guessing silently here is exactly the
// kind of invented detail this assistant exists to avoid.
export function extractMonths(text, referenceDate = new Date()) {
  const lower = text.toLowerCase();
  const found = [];

  if (/\bthis month\b/.test(lower)) found.push({ index: lower.indexOf("this month"), month: thisMonthStart(referenceDate) });
  if (/\blast month\b/.test(lower)) found.push({ index: lower.indexOf("last month"), month: lastMonthStart(referenceDate) });

  for (const name of MONTH_NAMES) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    const m = re.exec(lower);
    if (m) found.push({ index: m.index, month: resolveNamedMonth(name, referenceDate) });
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.month);
}

// "3 months unpaid", "three months", "3+ months" → 3. Words only cover
// one through six since that's the realistic range this ever comes up in;
// anything else falls back to the default the caller supplies.
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function extractMonthCount(text, fallback = 3) {
  const lower = text.toLowerCase();
  const digit = lower.match(/(\d+)\s*\+?\s*months?/);
  if (digit) return Number(digit[1]);
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b\\s*\\+?\\s*months?`).test(lower)) return n;
  }
  return fallback;
}
