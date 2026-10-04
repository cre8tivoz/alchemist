import { useState, useRef, useEffect } from "react";
import {
  Send,
  Sparkles,
  Play,
  Bookmark,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SqlBlock } from "@/features/workspace/SqlBlock";
import { SqlPreviewModal } from "@/features/sql-preview/SqlPreviewModal";
import { ResultsPanel } from "@/features/results/ResultsPanel";
import {
  useAppStore,
  type QueryResultData,
} from "@/state/app-store";
import { cn } from "@/lib/utils";

// ── Export helpers ──

function formatFileName(ext: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `alchemist-results-${ts}.${ext}`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    const escaped = s.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return s;
}

function mdCell(v: unknown): string {
  const s = String(v ?? "");
  const escaped = s.replace(/\|/g, "\\|");
  // Optimization (⚡ Bolt): Use single regex pass for newline replacements instead of 3 chained calls
  return escaped.replace(/\r\n|[\r\n]/g, "<br>");
}

async function exportResults(
  results: QueryResultData,
  format: "csv" | "markdown" | "json"
) {
  const { saveFile } = await import("@/lib/tauri");

  if (format === "json") {
    const json = results.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      results.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
    const content = JSON.stringify(json, null, 2);
    try {
      await saveFile(content, formatFileName("json"));
    } catch (err) {
      if (String(err) !== "cancelled") console.error("Export failed:", err);
    }
    return;
  }

  if (format === "csv") {
    const header = results.columns.map(csvCell).join(",");
    const rows = results.rows.map((row) => row.map(csvCell).join(","));
    const content = [header, ...rows].join("\n");
    try {
      await saveFile(content, formatFileName("csv"));
    } catch (err) {
      if (String(err) !== "cancelled") console.error("Export failed:", err);
    }
    return;
  }

  if (format === "markdown") {
    const header = `| ${results.columns.map(mdCell).join(" | ")} |`;
    const separator = `| ${results.columns.map(() => "---").join(" | ")} |`;
    const rows = results.rows.map(
      (row) => `| ${row.map(mdCell).join(" | ")} |`
    );
    const content = [header, separator, ...rows].join("\n");
    try {
      await saveFile(content, formatFileName("md"));
    } catch (err) {
      if (String(err) !== "cancelled") console.error("Export failed:", err);
    }
  }
}

// ── Component ──

export function ChatPanel() {
  const chatHistory = useAppStore((s) => s.chatHistory);
  const addChatMessage = useAppStore((s) => s.addChatMessage);
  const currentResults = useAppStore((s) => s.currentResults);
  const setCurrentResults = useAppStore((s) => s.setCurrentResults);
  const activeSource = useAppStore((s) => s.activeSource);
  const generatedSql = useAppStore((s) => s.generatedSql);
  const setGeneratedSql = useAppStore((s) => s.setGeneratedSql);

  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [hasRunQuery, setHasRunQuery] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Elapsed timer for running queries
  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Save spell modal
  const [showSaveSpell, setShowSaveSpell] = useState(false);
  const [saveSpellName, setSaveSpellName] = useState("");
  const [saveSpellDesc, setSaveSpellDesc] = useState("");
  const [saveSpellTags, setSaveSpellTags] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isGenerating, currentResults]);

  const handleSend = async () => {
    if (!input.trim() || !activeSource) return;
    const question = input.trim();
    setInput("");
    setHasRunQuery(false);
    setCurrentResults(null);
    setGeneratedSql(null);
    setGenerationError(null);
    setExecutionError(null);

    // Add user message
    addChatMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });

    // Generate query via Tauri backend
    setIsGenerating(true);

    try {
      const { generateQuery, getSchema } = await import("@/lib/tauri");
      const activeProvider = useAppStore.getState().activeProvider;
      const activeSource = useAppStore.getState().activeSource;

      let schemaJson: string | undefined = undefined;
      if (activeSource && useAppStore.getState().dataSourceType === "sqlite") {
        try {
          const schema = await getSchema(activeSource.path);
          schemaJson = JSON.stringify(schema);
        } catch {
          // Schema fetch failed, proceed without it
        }
      }

      const result = await generateQuery({
        question,
        schemaJson,
        providerType: activeProvider.type,
        providerUrl: activeProvider.url,
        providerModel: activeProvider.model,
        sourceType: useAppStore.getState().dataSourceType ?? undefined,
      });

      if (result.sql) {
        setGeneratedSql(result.sql);
      } else if (result.searchTerms && result.searchTerms.length > 0) {
        // Vector search — auto-run
        setGeneratedSql(null);
        await runVectorSearch(result.searchTerms);
      } else {
        // Raw response with no structured output — try to use it as-is
        setGenerationError(
          "Could not generate a query from that question. Try rephrasing."
        );
      }
    } catch (err) {
      const errorStr = String(err);
      // Provide helpful provider-specific messages
      let userMessage = errorStr;
      const provider = useAppStore.getState().activeProvider;
      if (
        errorStr.includes("Connection refused") ||
        errorStr.includes("Ollama request failed") ||
        errorStr.includes("error sending request")
      ) {
        userMessage =
          provider.type === "ollama"
            ? `**Ollama is not running.** Start it with \`ollama serve\` or check your Settings → AI Providers.`
            : `**${provider.type === "google-ai" ? "Gemini" : provider.type === "deepseek" ? "DeepSeek" : provider.type === "openai" ? "OpenAI" : "Provider"} is not reachable.** Check the URL and API key in Settings → AI Providers.`;
      } else if (errorStr.includes("API key not found")) {
        userMessage = `**No API key saved for ${provider.type === "google-ai" ? "Google AI Studio" : provider.type === "deepseek" ? "DeepSeek" : provider.type === "openai" ? "OpenAI" : "this provider"}.** Go to Settings → AI Providers to add one.`;
      } else if (errorStr.includes("401") || errorStr.includes("403")) {
        userMessage = `**Authentication failed.** The API key for ${provider.type === "google-ai" ? "Google AI Studio" : provider.type === "deepseek" ? "DeepSeek" : provider.type === "openai" ? "OpenAI" : "this provider"} may be invalid. Check it in Settings → AI Providers.`;
      }
      setGenerationError(userMessage);
    }

    setIsGenerating(false);
  };

  const runVectorSearch = async (terms: string[]) => {
    const src = useAppStore.getState().activeSource;
    if (!src) return;
    setIsRunning(true);

    try {
      const { searchDocuments } = await import("@/lib/tauri");
      const results = await searchDocuments(
        src.path,
        terms.join(" "),
        undefined,
        20
      );

      if (results.length === 0) {
        addChatMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `No results found for: ${terms.join(", ")}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      } else {
        // Convert search results to QueryResultData format
        const queryResult: QueryResultData = {
          columns: [
            "document",
            "score",
            "source",
            "created_at",
          ],
          rows: results.map((r) => [
            r.documentText,
            r.score ?? 0,
            r.segmentId,
            r.createdAt,
          ]),
          rowCount: results.length,
          truncated: results.length >= 20,
          elapsedMs: 0,
          mode: "vector",
        };
        setCurrentResults(queryResult);
        setHasRunQuery(true);
      }
    } catch (err) {
      setExecutionError(String(err));
    }

    setIsRunning(false);
  };

  const handleRunQuery = async () => {
    // Always read fresh state at call time to avoid stale closures
    const src = useAppStore.getState().activeSource;
    const dsType = useAppStore.getState().dataSourceType;
    const sql = generatedSql;
    if (!sql || !src) return;
    setShowPreview(false);
    setExecutionError(null);

    if (dsType === "chromadb" || dsType === "mempalace") {
      // For vector sources, run as search
      setIsRunning(true);
      try {
        const { searchDocuments } = await import("@/lib/tauri");
        const results = await searchDocuments(
          src.path,
          sql,
          undefined,
          20
        );

        const queryResult: QueryResultData = {
          columns: ["document", "score", "source", "created_at"],
          rows: results.map((r) => [
            r.documentText,
            r.score ?? 0,
            r.segmentId,
            r.createdAt,
          ]),
          rowCount: results.length,
          truncated: results.length >= 20,
          elapsedMs: 0,
          mode: "vector",
        };
        setCurrentResults(queryResult);
        setHasRunQuery(true);
      } catch (err) {
        setExecutionError(String(err));
      }
      setIsRunning(false);
      return;
    }

    // SQL mode — run real query
    setIsRunning(true);
    setExecutionError(null);
    setCurrentResults(null);

    try {
      const { validateAndRun } = await import("@/lib/tauri");
      const results = await validateAndRun(src.path, sql);

      const queryResult: QueryResultData = {
        columns: results.columns,
        rows: results.rows,
        rowCount: results.rowCount,
        truncated: results.truncated,
        elapsedMs: results.elapsedMs,
        mode: "sql",
      };
      setCurrentResults(queryResult);
      setHasRunQuery(true);
    } catch (err) {
      setExecutionError(String(err));
    }

    setIsRunning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveSpell = () => {
    if (!generatedSql || !saveSpellName.trim()) return;
    const addSpell = useAppStore.getState().addSpell;
    addSpell({
      id: crypto.randomUUID(),
      name: saveSpellName.trim(),
      description: saveSpellDesc.trim(),
      sql: generatedSql,
      mode: "sql",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: saveSpellTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setSaveSpellName("");
    setSaveSpellDesc("");
    setSaveSpellTags("");
    setShowSaveSpell(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b10] min-w-0">
      {/* Scrollable chat area */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {/* Initial prompt when no activity */}
        {chatHistory.length === 0 && !isGenerating && !generatedSql && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
            <Sparkles className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-sm text-zinc-500">
              {activeSource
                ? `Ask a question about ${activeSource.fileName}...`
                : "Open a database to start querying."}
            </p>
          </div>
        )}

        {/* Chat messages */}
        {chatHistory.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2.5",
                msg.role === "user"
                  ? "bg-violet-600/20 text-violet-100 border border-violet-500/20"
                  : "bg-white/[0.04] text-zinc-200 border border-white/[0.06]"
              )}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </p>
              <p className="text-[10px] text-zinc-600 mt-1 text-right">
                {msg.timestamp}
              </p>
            </div>
          </div>
        ))}

        {/* Generation status card */}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="max-w-[75%] rounded-2xl px-5 py-4 bg-[#0d0d1a] border border-violet-500/15 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-violet-600/30 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-violet-400" />
                </div>
                <span className="text-xs font-medium text-violet-400">
                  Alchemist
                </span>
              </div>
              <div className="space-y-1.5">
                {[
                  "Reading schema...",
                  "Finding relevant tables...",
                  "Generating read-only SQL...",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        i === 0
                          ? "bg-violet-400 animate-pulse"
                          : "bg-violet-600/30"
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs",
                        i === 0 ? "text-zinc-300" : "text-zinc-600"
                      )}
                    >
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Generation error */}
        {generationError && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 bg-red-500/5 border border-red-500/15">
              <p className="text-xs text-red-300/80">{generationError}</p>
            </div>
          </div>
        )}

        {/* Generated SQL */}
        {generatedSql && !isGenerating && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Here is the SQL I generated for you:
            </p>
            <SqlBlock sql={generatedSql} />

            {/* Action buttons */}
            <div className="flex items-center gap-2.5">
              <Button
                onClick={() => setShowPreview(true)}
                disabled={isRunning}
                className="h-9 px-4 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Run Query
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowSaveSpell(true)}
                className="h-9 px-4 rounded-lg text-xs font-medium border-white/[0.1] text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06]"
              >
                <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                Save as Spell
              </Button>
            </div>
          </div>
        )}

        {/* Execution error */}
        {executionError && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 bg-red-500/5 border border-red-500/15">
              <p className="text-xs text-red-300/80">{executionError}</p>
            </div>
          </div>
        )}

        {/* Running state */}
        {isRunning && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-5 py-3 bg-[#0d0d1a] border border-violet-500/15">
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-xs text-zinc-400">
                  Executing query on{" "}
                  <span className="text-zinc-300 font-medium">
                    {activeSource?.fileName ?? "database"}
                  </span>
                  ...
                </span>
                {elapsedSeconds > 0 && (
                  <span className="text-[10px] text-zinc-600 font-mono">
                    {elapsedSeconds}s
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {hasRunQuery && currentResults && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs text-zinc-500">
                Query completed in{" "}
                <span className="font-mono text-zinc-400">
                  {currentResults.elapsedMs}ms
                </span>
              </span>
            </div>
            <ResultsPanel
              onExport={(fmt) => exportResults(currentResults, fmt)}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-white/[0.06] px-4 py-3 bg-[#0d0d14]">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <div className="flex-1 relative">
            <Input
              placeholder={
                activeSource
                  ? "Ask your database anything..."
                  : "Open a database first"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating || isRunning || !activeSource}
              className="h-10 pl-4 pr-10 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl"
            />
            <Button
              size="icon"
              aria-label="Send query"
              title="Send query"
              onClick={handleSend}
              disabled={!input.trim() || isGenerating || isRunning || !activeSource}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* SQL Preview Modal */}
      {showPreview && generatedSql && (
        <SqlPreviewModal
          sql={generatedSql}
          onClose={() => setShowPreview(false)}
          onRun={() => {
            handleRunQuery();
          }}
        />
      )}

      {/* Save Spell Modal */}
      {showSaveSpell && generatedSql && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-white/[0.1] bg-[#0d0d14] shadow-2xl shadow-black/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-zinc-100">Save as Spell</h2>
              <button
                type="button"
                aria-label="Close modal"
                title="Close"
                onClick={() => setShowSaveSpell(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">Name</label>
                <input
                  value={saveSpellName}
                  onChange={(e) => setSaveSpellName(e.target.value)}
                  placeholder="e.g., Latest Ideas Query"
                  className="w-full h-9 px-3 text-sm bg-white/[0.04] border border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-violet-500/40"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSaveSpell()}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">Description</label>
                <input
                  value={saveSpellDesc}
                  onChange={(e) => setSaveSpellDesc(e.target.value)}
                  placeholder="What does this spell do?"
                  className="w-full h-9 px-3 text-sm bg-white/[0.04] border border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-violet-500/40"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">Tags</label>
                <input
                  value={saveSpellTags}
                  onChange={(e) => setSaveSpellTags(e.target.value)}
                  placeholder="ideas, search, local-first"
                  className="w-full h-9 px-3 text-sm bg-white/[0.04] border border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-violet-500/40"
                />
              </div>
              <div className="rounded-lg bg-black/40 border border-white/[0.04] px-3 py-2 max-h-20 overflow-y-auto">
                <code className="text-[11px] text-zinc-500 font-mono leading-relaxed">
                  {generatedSql}
                </code>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-white/[0.06] bg-white/[0.02]">
              <Button
                variant="ghost"
                onClick={() => setShowSaveSpell(false)}
                className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveSpell}
                disabled={!saveSpellName.trim()}
                className="h-9 px-5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 mr-1.5" />
                Save Spell
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
