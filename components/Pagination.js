import Link from "next/link";

function buildHref(searchParams, page) {
  const params = new URLSearchParams(searchParams);
  params.set("page", String(page));
  return `?${params.toString()}`;
}

// Windowed page numbers: first, last, current, and its immediate
// neighbours — collapsing everything else into "…", the same shape as the
// "[1] [2] [3] ... [49]" example rather than ever rendering all of them.
function pageWindow(current, total) {
  const pages = new Set([1, total, current, current - 1, current + 1]);
  return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
}

// Server-renderable — every control is a real <Link> with the page number
// in the URL, not client-side state, so a page link is shareable/
// bookmarkable and works with JS disabled.
export default function Pagination({ searchParams, page, pageSize, totalCount, itemLabel = "results" }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  const windowed = pageWindow(page, totalPages);

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-4 print:hidden">
      <p className="text-sm text-slate-500">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {totalCount.toLocaleString()} {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <Link
          href={buildHref(searchParams, Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={`text-sm px-3 py-1.5 rounded-lg border ${page <= 1 ? "border-slate-200 text-slate-300 pointer-events-none" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
        >
          Previous
        </Link>
        {windowed.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p - windowed[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <Link
              href={buildHref(searchParams, p)}
              aria-current={p === page ? "page" : undefined}
              className={`text-sm w-8 h-8 flex items-center justify-center rounded-lg ${p === page ? "bg-royal text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {p}
            </Link>
          </span>
        ))}
        <Link
          href={buildHref(searchParams, Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          tabIndex={page >= totalPages ? -1 : undefined}
          className={`text-sm px-3 py-1.5 rounded-lg border ${page >= totalPages ? "border-slate-200 text-slate-300 pointer-events-none" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
