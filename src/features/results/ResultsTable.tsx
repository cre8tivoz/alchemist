import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResultsTableProps {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  rowCount: number;
}

type SortDir = "asc" | "desc" | null;

export function ResultsTable({ columns, rows, truncated, rowCount }: ResultsTableProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else if (sortDir === "desc") {
        setSortCol(null);
        setSortDir(null);
      }
    } else {
      setSortCol(colIdx);
      setSortDir("asc");
    }
  };

  // Optimization (⚡ Bolt): Use Schwartzian transform (map-sort-map) to pre-extract
  // and convert sort keys O(N) times instead of O(N log N) during sorting comparator calls.
  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return rows;

    const mapped = rows.map((row) => {
      const val = row[sortCol];
      const isNum = typeof val === "number";
      const strVal = String(val ?? "");
      return { row, val, isNum, strVal };
    });

    mapped.sort((a, b) => {
      if (a.val === b.val || a.val === undefined || b.val === undefined) return 0;
      // Numeric comparison when both values are numbers
      if (a.isNum && b.isNum) {
        const numA = a.val as number;
        const numB = b.val as number;
        return sortDir === "asc" ? numA - numB : numB - numA;
      }
      // String comparison (keys precomputed in mapped)
      return sortDir === "asc"
        ? a.strVal.localeCompare(b.strVal)
        : b.strVal.localeCompare(a.strVal);
    });

    return mapped.map((item) => item.row);
  }, [rows, sortCol, sortDir]);

  const SortIcon = ({ colIdx }: { colIdx: number }) => {
    if (sortCol !== colIdx) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-violet-400" />
    ) : (
      <ArrowDown className="w-3 h-3 text-violet-400" />
    );
  };

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return "NULL";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  return (
    <div className="space-y-2 min-w-0 max-w-full">
      <div className="rounded-lg border border-white/[0.06] overflow-hidden min-w-0 max-w-full">
        <div className="overflow-auto max-h-[400px] max-w-full">
          <Table className="min-w-max">
            <TableHeader>
              <TableRow className="border-b border-white/[0.06] hover:bg-transparent">
                <TableHead className="w-10 text-xs text-zinc-500 font-medium text-center">
                  #
                </TableHead>
                {columns.map((col, i) => {
                  const isSorted = sortCol === i;
                  const sortState = isSorted
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  const sortHint =
                    sortState === "ascending"
                      ? "sort descending"
                      : sortState === "descending"
                      ? "clear sort"
                      : "sort ascending";

                  return (
                    <TableHead
                      key={col}
                      aria-sort={sortState}
                      className="p-0 text-xs font-medium whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(i)}
                        aria-label={`${col}, ${sortHint}`}
                        title={`${col} (${sortHint})`}
                        className={cn(
                          "flex items-center gap-1.5 w-full h-full px-2 py-2.5 text-left select-none transition-colors rounded-sm",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0d0d14]",
                          isSorted
                            ? "text-violet-300 font-semibold"
                            : "text-zinc-400 hover:text-zinc-200"
                        )}
                      >
                        <span>{col}</span>
                        <SortIcon colIdx={i} />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 1}
                    className="text-center text-zinc-600 py-8 text-sm"
                  >
                    No rows returned
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row, ri) => (
                  <TableRow
                    key={ri}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <TableCell className="text-xs text-zinc-600 font-mono text-center align-top pt-3">
                      {ri + 1}
                    </TableCell>
                    {/* Optimization (⚡ Bolt): Format cell value once per cell instead of calling formatValue twice */}
                    {/* (for title and children) and use ci as key to avoid `${ri}-${ci}` string allocations per cell. */}
                    {columns.map((_col, ci) => {
                      const cellVal = row[ci];
                      const formattedVal = formatValue(cellVal);
                      return (
                        <TableCell
                          key={ci}
                          className={cn(
                            "text-xs py-2.5 whitespace-nowrap max-w-[min(250px,60vw)] truncate",
                            cellVal === null || cellVal === undefined
                              ? "text-zinc-700 italic"
                              : "text-zinc-300"
                          )}
                          title={formattedVal}
                        >
                          {formattedVal}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {truncated && (
        <p className="text-xs text-amber-400/70 text-center">
          Results truncated. Showing {rows.length} of {rowCount} rows.
        </p>
      )}
    </div>
  );
}
