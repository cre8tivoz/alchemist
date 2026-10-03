import { useState, useMemo } from "react";
import {
  ChevronRight,
  Table,
  Columns,
  Search,
  Layers,
  FolderOpen,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { TableSchema, CollectionInfo, MemPalaceStructure } from "@/lib/tauri";
import { useAppStore } from "@/state/app-store";

interface SchemaPanelProps {
  tables?: TableSchema[];
  collections?: CollectionInfo[];
  palace?: MemPalaceStructure;
}

export function SchemaPanel({ tables, collections, palace }: SchemaPanelProps) {
  const dataSourceType = useAppStore((s) => s.dataSourceType);
  const [search, setSearch] = useState("");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [expandedWings, setExpandedWings] = useState<Set<string>>(new Set());
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  const toggleTable = (name: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleWing = (name: string) => {
    setExpandedWings((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleRoom = (name: string) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const title =
    dataSourceType === "chromadb"
      ? "COLLECTIONS"
      : dataSourceType === "mempalace"
        ? "PALACE"
        : "SCHEMA";

  // Optimization (⚡ Bolt): Memoize schema filtering computations to avoid redundant
  // search string lowercasing and array iterations on every component re-render / node toggle.
  const searchLower = search.trim().toLowerCase();

  const filteredWings = useMemo(() => {
    if (!palace?.wings) return undefined;
    if (!searchLower) return palace.wings;
    return palace.wings.filter((w) => w.name.toLowerCase().includes(searchLower));
  }, [palace?.wings, searchLower]);

  const filteredTables = useMemo(() => {
    if (!tables) return undefined;
    if (!searchLower) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(searchLower));
  }, [tables, searchLower]);

  const filteredCollections = useMemo(() => {
    if (!collections) return undefined;
    if (!searchLower) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(searchLower));
  }, [collections, searchLower]);

  return (
    <div className="w-64 lg:w-72 h-full flex flex-col bg-[#0d0d14] border-r border-white/[0.06]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest">
            {title}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-white/[0.03] border-white/[0.08] text-zinc-300 placeholder:text-zinc-600 rounded-lg"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {dataSourceType === "chromadb" ? (
          filteredCollections?.map((col) => (
            <SchemaItem
              key={col.id}
              label={col.name}
              subtitle={`${col.documentCount} docs · ${col.dimension ?? "?"}d`}
            />
          ))
        ) : dataSourceType === "mempalace" ? (
          filteredWings?.map((wing) => (
            <div key={wing.name}>
              <button
                onClick={() => toggleWing(wing.name)}
                className={cn(
                  "flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors",
                  expandedWings.has(wing.name)
                    ? "bg-violet-600/10 text-violet-300"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                )}
              >
                <ChevronRight
                  className={cn(
                    "w-3.5 h-3.5 transition-transform shrink-0",
                    expandedWings.has(wing.name) && "rotate-90"
                  )}
                />
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 text-left">{wing.name}</span>
                <span className="text-[10px] text-zinc-600">{wing.rooms.length} rooms</span>
              </button>

              {expandedWings.has(wing.name) && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {wing.rooms.map((room) => (
                    <div key={room.name}>
                      <button
                        onClick={() => toggleRoom(room.name)}
                        className={cn(
                          "flex items-center gap-2 w-full px-2.5 py-1 rounded-lg text-xs transition-colors",
                          expandedRooms.has(room.name)
                            ? "bg-white/[0.06] text-zinc-200"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "w-3 h-3 transition-transform shrink-0",
                            expandedRooms.has(room.name) && "rotate-90"
                          )}
                        />
                        <FolderOpen className="w-3 h-3 shrink-0" />
                        <span className="truncate flex-1 text-left">{room.name}</span>
                        <span className="text-[10px] text-zinc-600">
                          {room.drawers.length} drawers
                        </span>
                      </button>

                      {expandedRooms.has(room.name) && (
                        <div className="ml-4 mt-0.5 space-y-0.5">
                          {room.drawers.map((drawer, i) => (
                            <div
                              key={`${drawer.name}-${i}`}
                              className="flex items-center gap-2 px-2.5 py-1 rounded text-xs text-zinc-500 hover:text-zinc-400"
                            >
                              <FileText className="w-3 h-3 shrink-0" />
                              <span className="truncate flex-1">{drawer.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          filteredTables?.map((table) => (
              <div key={table.name}>
                <button
                  onClick={() => toggleTable(table.name)}
                  className={cn(
                    "flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors",
                    expandedTables.has(table.name)
                      ? "bg-violet-600/10 text-violet-300"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                  )}
                >
                  <ChevronRight
                    className={cn(
                      "w-3.5 h-3.5 transition-transform shrink-0",
                      expandedTables.has(table.name) && "rotate-90"
                    )}
                  />
                  <Table className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1 text-left">{table.name}</span>
                  {table.rowCount != null && (
                    <span className="text-[10px] text-zinc-600">{table.rowCount}</span>
                  )}
                </button>

                {expandedTables.has(table.name) && (
                  <div className="ml-6 mt-0.5 space-y-0.5">
                    {table.columns.map((col) => (
                      <div
                        key={col.name}
                        className="flex items-center gap-2 px-2.5 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        <Columns className="w-3 h-3 shrink-0" />
                        <span className="truncate flex-1">{col.name}</span>
                        <span className="text-[10px] text-zinc-600 shrink-0">
                          {col.declaredType}
                          {col.isPrimaryKey && " PK"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function SchemaItem({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors">
      <Table className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate flex-1">{label}</span>
      {subtitle && <span className="text-[10px] text-zinc-600 shrink-0">{subtitle}</span>}
    </div>
  );
}
