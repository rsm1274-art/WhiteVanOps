"use client";

import { useState, useEffect } from "react";
import { RotateCw, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";

// Chart ink/chrome — single-series charts, one hue per measure. Revenue keeps
// the same blue in both charts (color follows the measure). Aqua sits below
// 3:1 on white, so the tech-hours bars carry visible direct value labels.
const REVENUE_BLUE = "#2a78d6";
const HOURS_AQUA = "#1baf7a";
const MAINTENANCE_VIOLET = "#4a3aa7";
const GRID = "#e1e0d9";
const AXIS_INK = "#898781";

interface AnalyticsData {
  summary: {
    totalRevenue: number;
    jobsCompleted: number;
    avgJobValue: number;
    totalLaborHours: number;
    totalMaintenanceCost: number;
  };
  revenueByMonth: { month: string; revenue: number; jobs: number }[];
  hoursByTech: { name: string; hours: number }[];
  maintenanceByMonth: { month: string; cost: number }[];
  topClients: { name: string; revenue: number }[];
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** "2026-03" → "Mar" (with year on January for orientation) */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map((v) => parseInt(v, 10));
  const label = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  return m === 1 ? `${label} '${String(y).slice(2)}` : label;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded p-5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="text-2xl font-bold text-zinc-900 mt-1">{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded p-6">
      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-800">{title}</h4>
      <p className="text-[11px] text-zinc-500 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

const tooltipStyle = {
  fontSize: 12,
  border: "1px solid #e1e0d9",
  borderRadius: 4,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

export default function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error || "Failed to load analytics");
        setData(json);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load analytics"));
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <RotateCw className="h-4 w-4 animate-spin" />
        Crunching the numbers...
      </div>
    );
  }

  const { summary } = data;
  const revenueData = data.revenueByMonth.map((d) => ({ ...d, label: monthLabel(d.month) }));
  const maintenanceData = data.maintenanceByMonth.map((d) => ({ ...d, label: monthLabel(d.month) }));

  return (
    <div className="space-y-8">
      <div className="pb-4 border-b border-zinc-200">
        <h3 className="text-base font-bold uppercase text-zinc-800">Business Analytics</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Trailing 12 months. Revenue is the billed total of line items on completed jobs — labor cost is
          not tracked, so figures are revenue, not profit.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Revenue (12 mo)" value={money(summary.totalRevenue)} />
        <StatTile label="Jobs Completed" value={String(summary.jobsCompleted)} />
        <StatTile label="Avg Job Value" value={money(summary.avgJobValue)} />
        <StatTile
          label="Labor Hours Logged"
          value={summary.totalLaborHours.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        />
      </div>

      {/* Revenue by month */}
      <ChartCard title="Revenue by Month" subtitle="Billed line-item totals on completed jobs">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={revenueData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} width={70} />
            <Tooltip
              formatter={(value) => [money(Number(value)), "Revenue"]}
              labelFormatter={(label, payload) =>
                payload?.[0] ? `${label} — ${(payload[0].payload as { jobs: number }).jobs} jobs` : label
              }
              contentStyle={tooltipStyle}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
            />
            <Bar dataKey="revenue" fill={REVENUE_BLUE} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Technician hours */}
        <ChartCard title="Technician Hours" subtitle="Logged time per technician, trailing 12 months">
          {data.hoursByTech.length === 0 ? (
            <p className="text-sm text-zinc-500">No time entries in the last 12 months.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, data.hoursByTech.length * 44 + 30)}>
              <BarChart data={data.hoursByTech} layout="vertical" margin={{ top: 0, right: 56, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "#52514e" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => [`${value} hrs`, "Hours"]}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar dataKey="hours" fill={HOURS_AQUA} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="hours" position="right" formatter={(v) => `${v} h`} style={{ fontSize: 11, fill: "#52514e" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Top clients */}
        <ChartCard title="Top Clients by Revenue" subtitle="Highest-billing clients, trailing 12 months">
          {data.topClients.length === 0 ? (
            <p className="text-sm text-zinc-500">No completed jobs with billed line items yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, data.topClients.length * 44 + 30)}>
              <BarChart data={data.topClients} layout="vertical" margin={{ top: 0, right: 72, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tickFormatter={money} tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "#52514e" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => [money(Number(value)), "Revenue"]}
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar dataKey="revenue" fill={REVENUE_BLUE} radius={[0, 4, 4, 0]} maxBarSize={22}>
                  <LabelList dataKey="revenue" position="right" formatter={(v) => money(Number(v))} style={{ fontSize: 11, fill: "#52514e" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Fleet maintenance trend */}
      <ChartCard title="Fleet Maintenance Cost" subtitle="Logged maintenance spend per month, all vehicles">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={maintenanceData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={false} tickLine={false} width={70} />
            <Tooltip formatter={(value) => [money(Number(value)), "Cost"]} contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="cost"
              stroke={MAINTENANCE_VIOLET}
              strokeWidth={2}
              dot={{ r: 3, fill: MAINTENANCE_VIOLET, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
