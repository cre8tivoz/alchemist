import { Download, Table2, BarChart3, List, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ResultsTable } from "@/features/results/ResultsTable";
import { ResultsCharts } from "@/features/results/ResultsCharts";
import { useAppStore } from "@/state/app-store";

interface ResultsPanelProps {
  onExport: (format: "csv" | "markdown" | "json") => void;
}

export function ResultsPanel({ onExport }: ResultsPanelProps) {
  const results = useAppStore((s) => s.currentResults);
  const activeTab = useAppStore((s) => s.activeResultTab);
  const setActiveTab = useAppStore((s) => s.setActiveResultTab);
  const generatedSql = useAppStore((s) => s.generatedSql);

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
        <Table2 className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No results yet.</p>
        <p className="text-xs text-zinc-700 mt-1">
          Run a query to see results here.
        </p>
      </div>
    );
  }

  // Query ran but returned 0 rows
  if (results.rows.length === 0 && generatedSql) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-zinc-600">
        <Table2 className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">Query returned no results.</p>
        <p className="text-xs text-zinc-700 mt-1 max-w-md text-center">
          Try a different question or check that your data source contains matching data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            <span className="font-mono text-zinc-400">{results.rowCount}</span>{" "}
            row{results.rowCount !== 1 ? "s" : ""}
            {results.elapsedMs > 0 && (
              <>
                {" · "}
                <span className="font-mono text-zinc-500">
                  {results.elapsedMs}ms
                </span>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("csv")}
            aria-label="Export results as CSV"
            title="Export results as CSV"
            className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Download className="w-3 h-3 mr-1" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("markdown")}
            aria-label="Export results as Markdown"
            title="Export results as Markdown"
            className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <FileText className="w-3 h-3 mr-1" />
            MD
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("json")}
            aria-label="Export results as JSON"
            title="Export results as JSON"
            className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <FileText className="w-3 h-3 mr-1" />
            JSON
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "table" | "chart" | "relevance")}
      >
        <TabsList className="bg-white/[0.04] border border-white/[0.06]">
          <TabsTrigger
            value="table"
            className="text-xs data-[state=active]:bg-[#0D0B14]"
          >
            <Table2 className="w-3.5 h-3.5 mr-1.5" />
            Table
          </TabsTrigger>
          <TabsTrigger
            value="chart"
            className="text-xs data-[state=active]:bg-[#0D0B14]"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
            Chart
          </TabsTrigger>
          {results.mode === "vector" && (
            <TabsTrigger
              value="relevance"
              className="text-xs data-[state=active]:bg-[#0D0B14]"
            >
              <List className="w-3.5 h-3.5 mr-1.5" />
              Relevance
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="table" className="mt-2">
          <ResultsTable
            columns={results.columns}
            rows={results.rows}
            truncated={results.truncated}
            rowCount={results.rowCount}
          />
        </TabsContent>

        <TabsContent value="chart" className="mt-2">
          <ResultsCharts columns={results.columns} rows={results.rows} />
        </TabsContent>

        <TabsContent value="relevance" className="mt-2">
          <RelevanceView
            columns={results.columns}
            rows={results.rows}
            rowCount={results.rowCount}
            truncated={results.truncated}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RelevanceView({
  columns,
  rows,
  rowCount,
  truncated,
}: {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}) {
  // Auto-detect the text column (looks for "text", "content", "body", "document" or longest string column)
  const textColIdx = columns.findIndex((c) =>
    /text|content|body|document|excerpt|summary/i.test(c)
  );
  const scoreColIdx = columns.findIndex((c) =>
    /score|relevance|similarity|rank/i.test(c)
  );
  const sourceColIdx = columns.findIndex((c) =>
    /source|path|collection|segment|embedding/i.test(c)
  );

  return (
    <div className="space-y-1.5">
      {truncated && (
        <p className="text-xs text-amber-400/70 mb-2">
          Showing {rows.length} of {rowCount} results.
        </p>
      )}
      {rows.map((row, ri) => {
        const text =
          textColIdx >= 0
            ? String(row[textColIdx] ?? "")
            : row
                .filter((_, i) => i !== scoreColIdx && i !== sourceColIdx)
                .map((v) => String(v ?? ""))
                .join(" · ");
        const score =
          scoreColIdx >= 0 ? Number(row[scoreColIdx]) : null;
        const source =
          sourceColIdx >= 0 ? String(row[sourceColIdx] ?? "") : "";

        return (
          <div
            key={ri}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3">
                  {text}
                </p>
                {source && (
                  <p className="text-[10px] text-zinc-600 mt-1.5 truncate">
                    {source}
                  </p>
                )}
              </div>
              {score !== null && (
                <div className="shrink-0 flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                    style={{
                      backgroundColor: `hsla(${Math.round(
                        score * 120
                      )}, 70%, 50%, 0.15)`,
                      color: `hsl(${Math.round(score * 120)}, 70%, 60%)`,
                    }}
                  >
                    {Math.round(score * 100)}%
                  </div>
                  <span className="text-[9px] text-zinc-600 mt-0.5">
                    match
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
