"use client";

import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Actuals only — this chart never plots the forecast figure. Keeping the
// projection out of the same chart as real collected/expense bars is part
// of the same separation as the dashed-border styling on the Forecast
// card below it: a number appearing as just another bar on this axis
// would read as equally real to anyone glancing at it.
export default function ManagementCharts({ trend }) {
  const data = trend.map((t) => ({
    label: new Date(t.month + "T00:00:00").toLocaleString("en-US", { month: "short" }),
    Collected: Number(t.collected),
    Expenses: Number(t.expenses),
    Net: Number(t.net),
  }));

  const hasData = data.some((d) => d.Collected > 0 || d.Expenses > 0);

  if (!hasData) {
    return <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">No financial activity recorded yet in this range.</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Collected" fill="#2E5AAC" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Expenses" fill="#B4552F" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="Net" stroke="#4C9A6A" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
