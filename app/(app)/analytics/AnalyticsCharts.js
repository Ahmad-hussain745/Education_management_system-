"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="font-medium text-ink text-sm">{title}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      <div className="mt-3 h-56">{children}</div>
    </div>
  );
}

function money(n) {
  return "Rs. " + Number(n || 0).toLocaleString("en-US");
}

export default function AnalyticsCharts({ collectionByMonth, attendanceByMonth, studentsByClass, examAverages }) {
  const hasCollection = collectionByMonth.some((d) => d.total > 0);
  const hasAttendance = attendanceByMonth.some((d) => d.rate > 0);
  const hasStudents = studentsByClass.length > 0;
  const hasExams = examAverages.length > 0;

  return (
    <div className="grid md:grid-cols-2 gap-4 mt-6">
      <ChartCard title="Fee Collection" subtitle="Total collected per month">
        {hasCollection ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={collectionByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => `Rs. ${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="total" fill="#2E5AAC" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="No fee payments recorded yet." />
        )}
      </ChartCard>

      <ChartCard title="Attendance Rate" subtitle="% marked Present per month">
        {hasAttendance ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={attendanceByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="rate" stroke="#4C9A6A" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="No attendance recorded yet." />
        )}
      </ChartCard>

      <ChartCard title="Students by Class" subtitle="Active enrollment">
        {hasStudents ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={studentsByClass} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="count" fill="#B4552F" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="No active students yet." />
        )}
      </ChartCard>

      <ChartCard title="Exam Averages" subtitle="Average score % per exam">
        {hasExams ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={examAverages}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="average" fill="#7C5CBF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="No exam results recorded yet." />
        )}
      </ChartCard>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="h-full flex items-center justify-center text-xs text-slate-400">{text}</div>;
}
