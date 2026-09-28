import { useState, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Database, Shield, WifiOff, UserX, FileWarning, Ghost, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VaultCard } from "@/components/vault/VaultCard";
import { useAppStore, type RecentSource } from "@/state/app-store";
import {
  openVault,
  loadDemoDatabase,
  discoverPalace,
  parseMempalace,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

const featureBadges = [
  { label: "Local Only", icon: Shield },
  { label: "Read-Only", icon: Shield },
  { label: "No Account", icon: UserX },
  { label: "No Cloud API", icon: WifiOff },
];

const demoDatabases = [
  {
    id: "easy-coven",
    name: "Easy Coven",
    difficulty: "Easy",
    summary: "4 tables · 15 rows",
    description: "Witches, potions, customers, and transactions.",
  },
  {
    id: "medium-shadow",
    name: "Medium Shadow",
    difficulty: "Medium",
    summary: "5 tables · 18 rows",
    description: "People, covens, contracts, ingredients, and transactions.",
  },
  {
    id: "hard-eternal",
    name: "Hard Eternal",
    difficulty: "Hard",
    summary: "5 tables · 25 rows",
    description: "Entities, pacts, ledgers, artifacts, and transfers.",
  },
];

export function VaultScreen() {
  const recentSources = useAppStore((s) => s.recentSources);
  const addRecentSource = useAppStore((s) => s.addRecentSource);
  const removeRecentSource = useAppStore((s) => s.removeRecentSource);
  const setActiveSource = useAppStore((s) => s.setActiveSource);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [isDragging, setIsDragging] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleOpenFile = useCallback(async () => {
    setIsOpening(true);
    setOpenError(null);

    try {
      // Open native file dialog for supported file types
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Databases & Config",
            extensions: ["db", "sqlite", "sqlite3", "csv", "json", "yaml", "yml"],
          },
          {
            name: "SQLite Database",
            extensions: ["db", "sqlite", "sqlite3"],
          },
          {
            name: "Tabular Data",
            extensions: ["csv", "json", "yaml", "yml"],
          },
          {
            name: "MemPalace YAML",
            extensions: ["yaml", "yml"],
          },
        ],
      });

      if (!selected) {
        setIsOpening(false);
        return; // User cancelled
      }

      await openDataSource(selected as string);
    } catch (err) {
      setOpenError(String(err));
    }

    setIsOpening(false);
  }, []);

  const handleLoadMemPalace = useCallback(async () => {
    setIsOpening(true);
    setOpenError(null);

    try {
      // Let the backend discover ~/.mempalace cross-platform (YAML config or ChromaDB).
      const palace = await parseMempalace();
      const isChromaDb = palace.wings.length === 0 && palace.sourceFile.includes(".mempalace");
      if (palace.wings.length > 0 || isChromaDb) {
        const source: RecentSource = {
          path: palace.sourceFile,
          fileName: "MemPalace",
          type: isChromaDb ? "chromadb" : "mempalace",
          openedAt: new Date().toISOString(),
          summary: isChromaDb
            ? "ChromaDB database"
            : `${palace.totalWings} wings, ${palace.totalRooms} rooms, ${palace.totalDrawers} drawers`,
        };
        addRecentSource(source);
        setActiveSource(source);
        setActiveView("workspace");
      } else {
        setOpenError("No MemPalace found in ~/.mempalace on this machine.");
      }
    } catch {
      setOpenError("No MemPalace found in ~/.mempalace on this machine.");
    }

    setIsOpening(false);
  }, [addRecentSource, setActiveSource, setActiveView]);

  const handleLoadDemo = useCallback(async (dbName: string) => {
    setIsOpening(true);
    setOpenError(null);

    try {
      const vault = await loadDemoDatabase(dbName);
      const source: RecentSource = {
        path: vault.path,
        fileName: vault.fileName,
        type: "sqlite",
        openedAt: vault.openedAt,
        summary: `${vault.tableCount} tables, ${formatBytes(vault.sizeBytes)}`,
      };
      addRecentSource(source);
      setActiveSource(source);
      setActiveView("workspace");
    } catch (err) {
      setOpenError(String(err));
    }

    setIsOpening(false);
  }, [addRecentSource, setActiveSource, setActiveView]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Web drops give us file names — but in Tauri, drag-drop from Finder
    // gives file system paths via the webview. We need to extract the path.
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    const path = (file as unknown as { path: string }).path || file.name;
    if (!path) return;

    setIsOpening(true);
    setOpenError(null);

    try {
      await openDataSource(path);
    } catch (err) {
      setOpenError(String(err));
    }

    setIsOpening(false);
  }, []);

  const openDataSource = async (path: string) => {
    const lower = path.toLowerCase();

    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      try {
        const palace = await parseMempalace(path);
        const looksLikePalace = palace.totalRooms > 0 || palace.totalDrawers > 0;
        if (looksLikePalace) {
          const source: RecentSource = {
            path,
            fileName: path.split("/").pop() || path,
            type: "mempalace",
            openedAt: new Date().toISOString(),
            summary: `${palace.totalWings} wings, ${palace.totalRooms} rooms, ${palace.totalDrawers} drawers`,
          };
          addRecentSource(source);
          setActiveSource(source);
          setActiveView("workspace");
          return;
        }
      } catch {
        // Not a MemPalace YAML file; try tabular import below.
      }
    }

    // Try ChromaDB directory (has chroma.sqlite3 inside)
    if (
      !lower.endsWith(".db") &&
      !lower.endsWith(".sqlite") &&
      !lower.endsWith(".sqlite3") &&
      !lower.endsWith(".csv") &&
      !lower.endsWith(".json") &&
      !lower.endsWith(".yaml") &&
      !lower.endsWith(".yml")
    ) {
      // Could be a ChromaDB persistence directory
      try {
        const discovery = await discoverPalace(path);
        const source: RecentSource = {
          path,
          fileName: path.split("/").pop() || path,
          type: "chromadb",
          openedAt: new Date().toISOString(),
          summary: `${discovery.collectionCount} collections, ${discovery.totalDocuments} documents`,
        };
        addRecentSource(source);
        setActiveSource(source);
        setActiveView("workspace");
        return;
      } catch {
        // Not a ChromaDB directory either
        throw new Error(
          `Unsupported file type. Please open a .db, .sqlite, .sqlite3, .csv, .json, .yaml, or .yml file, or a ChromaDB persistence directory.`
        );
      }
    }

    // SQLite database or imported tabular file
    try {
      const vault = await openVault(path);
      const source: RecentSource = {
        path,
        fileName: vault.fileName,
        type: "sqlite",
        openedAt: vault.openedAt,
        summary: `${vault.tableCount} tables, ${formatBytes(vault.sizeBytes)}`,
      };
      addRecentSource(source);
      setActiveSource(source);
      setActiveView("workspace");
    } catch (err) {
      throw new Error(`Failed to open database: ${err}`);
    }
  };

  const handleRecentClick = (source: RecentSource) => {
    setActiveSource(source);
    setActiveView("workspace");
  };

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-[#0b0b10]">
      {/* Cosmic background texture */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] rounded-full bg-blue-500/4 blur-[100px]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-r from-violet-500/3 via-fuchsia-500/2 to-transparent blur-[80px] rotate-12" />
      </div>

      {/* Content */}
      <div
        ref={dropRef}
        className={cn(
          "flex-1 flex flex-col items-center justify-center px-8 py-12 relative z-10 transition-all duration-200",
          isDragging && "bg-violet-500/5"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hero section */}
        <div className="flex flex-col items-center max-w-lg w-full">
          {/* Logo */}
          <div className="mb-6 relative">
            <svg
              viewBox="0 0 48 48"
              className="w-14 h-14 text-violet-500 drop-shadow-[0_0_20px_rgba(139,92,246,0.3)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M24 6 L42 36 L6 36 Z" />
              <circle cx="24" cy="28" r="7" />
              <circle cx="24" cy="28" r="3" fill="currentColor" opacity="0.8" />
              <line x1="24" y1="6" x2="24" y2="12" strokeWidth="1" opacity="0.4" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="font-['Cinzel'] text-4xl md:text-5xl font-semibold tracking-[0.15em] text-[#f3f0ea] mb-3 text-center">
            ALCHEMIST
          </h1>

          {/* Subtitle */}
          <p className="text-violet-400 text-base md:text-lg font-normal mb-8 text-center">
            Ask your local database what it knows.
          </p>

          {/* CTA Button */}
          <Button
            onClick={handleOpenFile}
            disabled={isOpening}
            className={cn(
              "h-11 px-8 rounded-xl text-sm font-medium",
              "bg-gradient-to-b from-violet-600 to-violet-700",
              "hover:from-violet-500 hover:to-violet-600",
              "shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:shadow-[0_0_30px_rgba(139,92,246,0.35)]",
              "text-white border border-violet-400/20",
              "transition-all duration-200",
              isOpening && "opacity-70 animate-pulse"
            )}
          >
            <Database className="w-4 h-4 mr-2" />
            {isOpening ? "Opening..." : "Open Database..."}
          </Button>

          {/* MemPalace Button */}
          <Button
            onClick={handleLoadMemPalace}
            disabled={isOpening}
            className={cn(
              "h-11 px-8 rounded-xl text-sm font-medium mt-3",
              "bg-gradient-to-b from-emerald-500/80 to-emerald-700/80",
              "hover:from-emerald-400/90 hover:to-emerald-600/90",
              "shadow-[0_0_20px_rgba(16,185,129,0.15)] hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]",
              "text-emerald-100 border border-emerald-400/20",
              "transition-all duration-200",
              isOpening && "opacity-70 animate-pulse"
            )}
          >
            <Ghost className="w-4 h-4 mr-2" />
            {isOpening ? "Summoning..." : "Load MemPalace"}
          </Button>

          {/* Drop hint */}
          <p className="text-xs text-zinc-500 mt-3 mb-8">
            or drag and drop .db / .sqlite / .csv / .json / .yaml data
          </p>

          {/* Error message */}
          {openError && (
            <div className="flex items-start gap-2 px-4 py-3 mb-6 rounded-lg bg-red-500/5 border border-red-500/15 max-w-sm">
              <FileWarning className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/80">{openError}</p>
            </div>
          )}

          {/* Feature badges */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 mb-12">
            {featureBadges.map((badge) => {
              const Icon = badge.icon;
              return (
                <Badge
                  key={badge.label}
                  variant="outline"
                  className={cn(
                    "h-7 px-2.5 rounded-full text-xs font-normal",
                    "bg-white/[0.03] border-white/[0.1] text-zinc-300",
                    "flex items-center gap-1.5"
                  )}
                >
                  <Icon className="w-3 h-3 text-violet-400/70" />
                  {badge.label}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Demo Databases */}
        <div className="w-full max-w-3xl mb-8">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">
            Demo Databases
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {demoDatabases.map((demo) => (
              <button
                key={demo.id}
                type="button"
                onClick={() => handleLoadDemo(demo.id)}
                disabled={isOpening}
                className={cn(
                  "text-left rounded-lg border border-white/[0.08] bg-white/[0.03] p-4",
                  "hover:border-violet-400/30 hover:bg-violet-500/[0.06] transition-colors",
                  "disabled:opacity-60 disabled:cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FlaskConical className="w-4 h-4 text-violet-400 shrink-0" />
                    <span className="text-sm font-medium text-zinc-200 truncate">
                      {demo.name}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] rounded border-white/[0.1] text-zinc-400 bg-black/20"
                  >
                    {demo.difficulty}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-500 mb-2">{demo.summary}</p>
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  {demo.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Vaults */}
        <div className="w-full max-w-md">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">
            Recent Vaults
          </h2>

          <div className="flex flex-col gap-2">
            {recentSources.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-zinc-600 mb-1">
                  No recent databases.
                </p>
                <p className="text-xs text-zinc-700">
                  Open a database or YAML file, or ensure MemPalace is configured at{' '}
                  <code className="text-[10px] px-1 py-0.5 rounded bg-white/[0.04] text-zinc-500">
                    ~/.mempalace/
                  </code>
                </p>
              </div>
            ) : (
              recentSources.map((source) => (
                <VaultCard
                  key={source.path}
                  type={source.type === 'mempalace' || source.type === 'chromadb' ? 'csv' : 'sqlite'}
                  name={source.fileName}
                  metadata={source.summary}
                  onClick={() => handleRecentClick(source)}
                  onRemove={() => removeRecentSource(source.path)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
