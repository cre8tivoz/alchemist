import { useState, useRef, useEffect } from 'react';
import { Database, FileCode, MoreHorizontal, Trash2, FolderOpen } from 'lucide-react';

interface VaultCardProps {
  name: string;
  type: 'sqlite' | 'duckdb' | 'csv' | 'parquet';
  metadata: string;
  onClick: () => void;
  onRemove?: () => void;
}

export function VaultCard({ name, type, metadata, onClick, onRemove }: VaultCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const Icon = type === 'sqlite' || type === 'duckdb' ? Database : FileCode;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${name} database, ${metadata}`}
      className="group relative flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all text-left w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0b10]"
    >
      {/* Icon */}
      <div className="p-2 rounded-md bg-purple-500/10 text-purple-400">
        <Icon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">{name}</p>
        <p className="text-xs text-zinc-500 truncate">{metadata}</p>
      </div>

      {/* Kebab menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-label={`More options for ${name}`}
          title="More options"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          aria-expanded={isOpen}
          aria-haspopup="true"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none transition-opacity p-1 rounded hover:bg-white/[0.08]"
        >
          <MoreHorizontal className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 rounded-md bg-zinc-900 border border-white/10 shadow-lg py-1 z-50">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                onClick();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              Open Database
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  onRemove();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                Remove from Recents
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
