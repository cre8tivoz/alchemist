import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  Plus,
  Play,
  Pencil,
  Trash2,
  Clock,
  Tag,
  Sparkles,
  X,
  Check,
  Bookmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type Spell } from "@/state/app-store";
import { loadSpells, saveSpells } from "@/lib/tauri";

export function SpellsScreen() {
  const spells = useAppStore((s) => s.spells);
  const deleteSpell = useAppStore((s) => s.deleteSpell);
  const updateSpell = useAppStore((s) => s.updateSpell);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setGeneratedSql = useAppStore((s) => s.setGeneratedSql);
  const setCurrentQuery = useAppStore((s) => s.setCurrentQuery);

  // Load spells from disk on mount (only once, with dedup)
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const init = async () => {
      try {
        const json = await loadSpells();
        const loaded: Spell[] = JSON.parse(json);
        const addSpell = useAppStore.getState().addSpell;
        const currentSpells = useAppStore.getState().spells;
        const existingIds = new Set(currentSpells.map((s) => s.id));
        for (const spell of loaded) {
          if (!existingIds.has(spell.id)) {
            addSpell(spell);
          }
        }
      } catch {
        // No saved spells — that's fine
      }
    };
    init();
  }, []);

  // Save spells to disk whenever they change (after initial load)
  const hasLoadedRef2 = useRef(false);
  useEffect(() => {
    if (!hasLoadedRef2.current) {
      hasLoadedRef2.current = true;
      return;
    }
    if (spells.length === 0) return;
    const json = JSON.stringify(spells);
    saveSpells(json).catch(() => {});
  }, [spells]);

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNewSpell, setShowNewSpell] = useState(false);
  const [newSpellName, setNewSpellName] = useState("");
  const [newSpellDesc, setNewSpellDesc] = useState("");
  const [newSpellTags, setNewSpellTags] = useState("");

  const filteredSpells = useMemo(() => {
    if (!search.trim()) return spells;
    const q = search.toLowerCase();
    return spells.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)) ||
        s.sql.toLowerCase().includes(q)
    );
  }, [spells, search]);

  const handleRun = (spell: Spell) => {
    setGeneratedSql(spell.sql);
    setCurrentQuery(spell.description);
    setActiveView("workspace");
  };

  const handleDelete = (id: string) => {
    deleteSpell(id);
    if (editingId === id) setEditingId(null);
  };

  const handleStartEdit = (spell: Spell) => {
    setEditingId(spell.id);
    setEditName(spell.name);
  };

  const handleSaveEdit = (id: string) => {
    if (editName.trim()) {
      updateSpell(id, { name: editName.trim() });
    }
    setEditingId(null);
  };

  const handleCreateSpell = () => {
    if (!newSpellName.trim()) return;
    const addSpell = useAppStore.getState().addSpell;
    addSpell({
      id: crypto.randomUUID(),
      name: newSpellName.trim(),
      description: newSpellDesc.trim(),
      sql: "",
      mode: "sql",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: newSpellTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setNewSpellName("");
    setNewSpellDesc("");
    setNewSpellTags("");
    setShowNewSpell(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b10] min-w-0">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Spells</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Saved queries you can run again anytime
            </p>
          </div>
          <Button
            onClick={() => setShowNewSpell(true)}
            className="h-9 px-4 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Spell
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <Input
            placeholder="Search spells by name, tag, or SQL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 pr-4 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl"
          />
        </div>
      </div>

      {/* Spells list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {spells.length === 0 && !showNewSpell ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <Bookmark className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium text-zinc-500">No spells yet</p>
            <p className="text-xs text-zinc-700 mt-1">
              Save queries from the workspace as reusable spells.
            </p>
          </div>
        ) : filteredSpells.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
            <Search className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm text-zinc-500">No spells match "{search}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSpells.map((spell) => (
              <div
                key={spell.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className="px-4 py-3">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {editingId === spell.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 rounded-lg"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(spell.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Save spell name"
                            title="Save name"
                            onClick={() => handleSaveEdit(spell.id)}
                            className="h-7 w-7 text-emerald-400 hover:text-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Cancel editing"
                            title="Cancel editing"
                            onClick={() => setEditingId(null)}
                            className="h-7 w-7 text-zinc-500 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-violet-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <h3 className="text-sm font-medium text-zinc-200 truncate">
                          {spell.name}
                        </h3>
                      )}
                      {spell.description && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
                          {spell.description}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Run spell ${spell.name}`}
                        title={`Run ${spell.name}`}
                        onClick={() => handleRun(spell)}
                        className="h-7 w-7 text-zinc-400 hover:text-violet-400 hover:bg-violet-600/10 focus-visible:ring-2 focus-visible:ring-violet-500"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Rename spell ${spell.name}`}
                        title={`Rename ${spell.name}`}
                        onClick={() => handleStartEdit(spell)}
                        className="h-7 w-7 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-500"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete spell ${spell.name}`}
                        title={`Delete ${spell.name}`}
                        onClick={() => handleDelete(spell.id)}
                        className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-violet-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* SQL preview */}
                  {spell.sql && (
                    <div className="mt-2 rounded-lg bg-black/40 border border-white/[0.04] px-3 py-1.5">
                      <code className="text-[11px] text-zinc-500 font-mono line-clamp-2 leading-relaxed">
                        {spell.sql}
                      </code>
                    </div>
                  )}

                  {/* Meta row */}
                  <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                      <Clock className="w-3 h-3" />
                      {formatDate(spell.updatedAt)}
                    </span>
                    {spell.mode === "vector" && (
                      <Badge
                        variant="outline"
                        className="h-5 px-1.5 text-[10px] font-normal text-cyan-400 border-cyan-500/20 bg-cyan-500/5"
                      >
                        <Sparkles className="w-2.5 h-2.5 mr-1" />
                        vector
                      </Badge>
                    )}
                    {spell.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="h-5 px-1.5 text-[10px] font-normal text-zinc-400 border-white/[0.08]"
                      >
                        <Tag className="w-2.5 h-2.5 mr-1" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Spell Modal */}
      {showNewSpell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-white/[0.1] bg-[#0d0d14] shadow-2xl shadow-black/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-zinc-100">New Spell</h2>
              <button
                type="button"
                aria-label="Close modal"
                title="Close"
                onClick={() => setShowNewSpell(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">
                  Name
                </label>
                <Input
                  value={newSpellName}
                  onChange={(e) => setNewSpellName(e.target.value)}
                  placeholder="e.g., Latest Ideas"
                  className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreateSpell()}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">
                  Description
                </label>
                <Input
                  value={newSpellDesc}
                  onChange={(e) => setNewSpellDesc(e.target.value)}
                  placeholder="What does this spell do?"
                  className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 font-medium mb-1.5 block">
                  Tags (comma separated)
                </label>
                <Input
                  value={newSpellTags}
                  onChange={(e) => setNewSpellTags(e.target.value)}
                  placeholder="ideas, search, local-first"
                  className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-zinc-200 placeholder:text-zinc-600 rounded-xl"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-white/[0.06] bg-white/[0.02]">
              <Button
                variant="ghost"
                onClick={() => setShowNewSpell(false)}
                className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateSpell}
                disabled={!newSpellName.trim()}
                className="h-9 px-5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
              >
                Create Spell
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
