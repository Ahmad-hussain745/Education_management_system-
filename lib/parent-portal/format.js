export function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function monthLabel(month) {
  if (!month) return "—";
  return new Date(month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export const STATUS_LABEL = { present: "Present", absent: "Absent", late: "Late", leave: "Leave" };
export const STATUS_COLOR = {
  present: "bg-sage-tint text-sage",
  late: "bg-amber-50 text-amber-700",
  absent: "bg-brick-tint text-brick",
  leave: "bg-soft-blue text-royal",
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = Number(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}
