import { useEffect, useState } from "react";
import { SchemaPanel } from "@/features/workspace/SchemaPanel";
import { ChatPanel } from "@/features/workspace/ChatPanel";
import { InspectorPanel } from "@/features/workspace/InspectorPanel";
import { ProviderSelector } from "@/components/workspace/ProviderSelector";
import { useAppStore } from "@/state/app-store";
import { getSchema, listCollections, parseMempalace } from "@/lib/tauri";
import type { TableSchema, CollectionInfo, MemPalaceStructure } from "@/lib/tauri";

export function Workspace() {
  const activeSource = useAppStore((s) => s.activeSource);
  const dataSourceType = useAppStore((s) => s.dataSourceType);

  // Schema data state
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [palace, setPalace] = useState<MemPalaceStructure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSource) return;

    const loadSchema = async () => {
      setError(null);

      try {
        if (dataSourceType === "sqlite") {
          const result = await getSchema(activeSource.path);
          setTables(result);
        } else if (dataSourceType === "chromadb") {
          const result = await listCollections(activeSource.path);
          setCollections(result);
        } else if (dataSourceType === "mempalace") {
          const result = await parseMempalace(activeSource.path);
          setPalace(result);
        }
      } catch (err) {
        setError(String(err));
      }
    };

    loadSchema();
  }, [activeSource?.path, dataSourceType]);

  if (!activeSource) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0b0b10]">
        <div className="text-center">
          <p className="text-zinc-500 text-sm">Open a database to start querying.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0b0b10]">
        <div className="text-center">
          <p className="text-red-400 text-sm">Failed to load schema</p>
          <p className="text-zinc-600 text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top toolbar */}
      <div className="h-10 flex items-center justify-between px-4 bg-[#0b0b10] border-b border-white/[0.06] shrink-0">
        <span className="text-xs text-zinc-500 font-medium">Workspace</span>
        <div className="flex items-center gap-3">
          <ProviderSelector />
        </div>
      </div>

      {/* Main three-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Schema panel */}
        <SchemaPanel tables={tables} collections={collections} palace={palace ?? undefined} />

        {/* Center: Chat */}
        <ChatPanel />

        {/* Right: Inspector */}
        <InspectorPanel palace={palace} />
      </div>
    </div>
  );
}
