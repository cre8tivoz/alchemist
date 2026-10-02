import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart3, PieChart as PieChartIcon, TrendingUp } from "lucide-react";

interface ResultsChartsProps {
  columns: string[];
  rows: unknown[][];
}

type ChartType = "bar" | "line" | "pie";

interface DetectedChart {
  type: ChartType;
  labelCol: number;
  valueCol: number;
  label: string;
}

function detectCharts(columns: string[], rows: unknown[][]): DetectedChart[] {
  if (rows.length === 0 || columns.length < 2) return [];

  const charts: DetectedChart[] = [];
  const stringCols: number[] = [];
  const numericCols: number[] = [];

  columns.forEach((_col, i) => {
    const sample = rows.slice(0, Math.min(5, rows.length)).map((r) => r[i]);
    const allNumeric = sample.every(
      (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v))
    );
    if (allNumeric && sample.length > 0) {
      numericCols.push(i);
    } else {
      stringCols.push(i);
    }
  });

  if (numericCols.length === 0) return [];

  for (const sc of stringCols) {
    // Optimization (⚡ Bolt): Build Set with early termination once vals.size > 20
    // to avoid scanning all N rows and allocating an intermediate array per string column.
    const vals = new Set<string>();
    for (const r of rows) {
      vals.add(String(r[sc] ?? ""));
      if (vals.size > 20) break;
    }
    if (vals.size > 20) continue;

    charts.push({
      type: "bar",
      labelCol: sc,
      valueCol: numericCols[0],
      label: `${columns[sc]} by ${columns[numericCols[0]]}`,
    });

    if (vals.size <= 10 && vals.size >= 2) {
      charts.push({
        type: "pie",
        labelCol: sc,
        valueCol: numericCols[0],
        label: `${columns[numericCols[0]]} by ${columns[sc]}`,
      });
    }

    if (charts.length >= 3) return charts.slice(0, 3);
  }

  if (numericCols.length >= 2 && charts.length < 3) {
    charts.push({
      type: "line",
      labelCol: numericCols[0],
      valueCol: numericCols[1],
      label: `${columns[numericCols[1]]} over ${columns[numericCols[0]]}`,
    });
  }

  return charts.slice(0, 3);
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#C084FC",
  "#34D399",
  "#FBBF24",
  "#F472B6",
  "#60A5FA",
];

const chartTypeIcons: Record<ChartType, React.ReactNode> = {
  bar: <BarChart3 className="w-4 h-4" />,
  line: <TrendingUp className="w-4 h-4" />,
  pie: <PieChartIcon className="w-4 h-4" />,
};

interface DetectedChartWithData extends DetectedChart {
  chartData: Array<{ label: string; value: number }>;
}

export function ResultsCharts({ columns, rows }: ResultsChartsProps) {
  // Optimization (⚡ Bolt): Pre-compute chart data and memoize along with detected charts
  // so chartData mapping isn't re-executed on every component render / tooltip hover.
  const charts = useMemo<DetectedChartWithData[]>(() => {
    const detected = detectCharts(columns, rows);
    return detected.map((chart) => ({
      ...chart,
      chartData: rows.map((r) => ({
        label: String(r[chart.labelCol] ?? ""),
        value: Number(r[chart.valueCol] ?? 0),
      })),
    }));
  }, [columns, rows]);

  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
        <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No chart could be auto-detected from this data.</p>
        <p className="text-xs text-zinc-700 mt-1">
          Charts need at least one text column and one numeric column.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10 p-2">
      {charts.map((chart, ci) => {
        const chartData = chart.chartData;

        const chartConfig = {
          value: {
            label: columns[chart.valueCol],
            color: CHART_COLORS[0],
          },
          label: {
            label: columns[chart.labelCol],
          },
        };

        return (
          <div
            key={ci}
            className="rounded-xl border border-white/[0.06] bg-[#0D0B14] p-6"
          >
            <div className="flex items-center gap-2 mb-5">
              {chartTypeIcons[chart.type]}
              <h4 className="text-sm font-medium text-zinc-300">{chart.label}</h4>
            </div>
            <div className="h-[320px]">
              {chart.type === "bar" && (
                <ChartContainer config={chartConfig}>
                  <BarChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(138,74,251,0.08)" }}
                      content={<ChartTooltipContent />}
                    />
                    <Bar
                      dataKey="value"
                      fill="var(--chart-1)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ChartContainer>
              )}
              {chart.type === "line" && (
                <ChartContainer config={chartConfig}>
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ChartTooltip
                      cursor={{ stroke: "rgba(138,74,251,0.3)" }}
                      content={<ChartTooltipContent />}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={{ fill: "var(--chart-1)", r: 3 }}
                      activeDot={{ r: 5, fill: "var(--chart-1)" }}
                    />
                  </LineChart>
                </ChartContainer>
              )}
              {chart.type === "pie" && (
                <ChartContainer config={chartConfig}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      {chartData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ChartContainer>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
