"use client";

// Same "one file covers every route under (app)" reasoning as loading.js.
// Without this, an unhandled error anywhere in a page's render (a null
// reference on unexpected data shape, a third-party component throwing,
// etc.) took down the whole app with Next's generic dev overlay / a blank
// production page — and in dev, each of those is exactly what shows up in
// a terminal log as "Fast Refresh had to perform a full reload due to a
// runtime error," discarding the incremental compile cache and forcing a
// full recompile of everything reachable from that route. This boundary
// catches it at the route level instead: the sidebar/shell stay intact,
// and "Try again" re-renders just this segment via reset() without a full
// page reload.
export default function AppError({ error, reset }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      <div className="text-lg font-semibold text-ink mb-2">Something went wrong loading this page.</div>
      <p className="text-sm text-slate-500 max-w-md mb-5">
        {error?.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="text-sm px-4 py-2 rounded-lg bg-royal text-white"
        >
          Try again
        </button>
        <a href="/dashboard" className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700">
          Back to Dashboard
        </a>
      </div>
    </div>
  );
}
