import Link from "next/link";

// A <th> that's also a sort toggle: click cycles asc → desc for that
// column, and changing the sort resets back to page 1 (the current page
// number almost never still makes sense against the new order).
export default function SortableTh({ label, sortKey, currentSort, searchParams, align = "left" }) {
  const isAsc = currentSort === `${sortKey}_asc`;
  const isDesc = currentSort === `${sortKey}_desc`;
  const nextSort = isAsc ? `${sortKey}_desc` : `${sortKey}_asc`;
  const params = new URLSearchParams(searchParams);
  params.set("sort", nextSort);
  params.delete("page");

  return (
    <th className={`px-4 py-3 text-${align}`}>
      <Link href={`?${params.toString()}`} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        {(isAsc || isDesc) && <span aria-hidden="true">{isAsc ? "↑" : "↓"}</span>}
      </Link>
    </th>
  );
}
