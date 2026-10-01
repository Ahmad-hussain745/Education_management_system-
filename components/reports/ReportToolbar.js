"use client";

// Shared by every /reports/* page. "Export CSV" is a real file, generated
// client-side from the exact rows the page rendered — no server round trip,
// no library. "PDF" is intentionally the browser's own Print → Save as PDF,
// not a fabricated binary — a client-side PDF library isn't in this
// project's approved dependency set, and Print-to-PDF is the honest way to
// get a real PDF without pretending to a capability that isn't there.
// print:hidden (see globals.css) hides this toolbar and the sidebar when
// the browser's print dialog actually renders the page.
export default function ReportToolbar({ rows, columns, filename }) {
  const handlePrint = () => window.print();

  const handleExportCsv = () => {
    const escape = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map((c) => escape(c.label)).join(",");
    const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(",")).join("\n");
    const csv = `${header}\n${body}`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button onClick={handlePrint} className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
        Print / Save as PDF
      </button>
      <button onClick={handleExportCsv} className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
        Export CSV
      </button>
    </div>
  );
}
