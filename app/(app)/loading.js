// Applies to every route under (app) — Next's App Router walks UP the
// layout tree for the nearest loading.js, so one file here covers all
// ~130 pages (dashboard, students, payroll, exams, everything) instead of
// needing one per route. Shown automatically while a Server Component
// page is fetching its data — this is the actual mechanism that makes a
// slow query FEEL fast: the sidebar and page shell paint immediately,
// only the content area shows this skeleton until the real data resolves.
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-48 bg-slate-200 rounded" />
      <div className="h-4 w-72 bg-slate-100 rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-slate-100 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-slate-100 rounded-xl mt-6" />
    </div>
  );
}
