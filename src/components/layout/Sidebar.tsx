import { FlaskConical, ScrollText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/app-store";

const navItems = [
  { id: "vault" as const, label: "Vaults", icon: FlaskConical },
  { id: "spells" as const, label: "Spells", icon: ScrollText },
  { id: "settings" as const, label: "Settings", icon: Settings },
];

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <aside className="flex flex-col w-[72px] lg:w-32 h-full bg-[#0d0d14] border-r border-white/[0.06] py-6 items-center shrink-0">
      {/* Top logo */}
      <div className="mb-8 flex flex-col items-center gap-1">
        <svg
          viewBox="0 0 32 32"
          className="w-7 h-7 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M16 4 L28 24 L4 24 Z" />
          <circle cx="16" cy="19" r="4" />
          <circle cx="16" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </div>

      {/* Nav Items */}
      <nav className="flex flex-col gap-2 w-full px-2 lg:px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <Button
              key={item.id}
              variant="ghost"
              aria-label={item.label}
              title={item.label}
              onClick={() => setActiveView(item.id)}
              className={cn(
                "flex items-center justify-center lg:justify-start gap-3 h-10 w-full rounded-lg transition-all",
                isActive
                  ? "bg-violet-600/20 text-violet-300 border border-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.08)]"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
              )}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="hidden lg:block text-sm font-medium">
                {item.label}
              </span>
            </Button>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom brand */}
      <div className="flex flex-col items-center gap-1.5">
        <svg
          viewBox="0 0 20 20"
          className="w-4 h-4 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M10 2 L18 16 L2 16 Z" />
          <circle cx="10" cy="12" r="2.5" />
        </svg>
        <div className="text-center">
          <p className="text-[9px] font-medium text-zinc-600 uppercase tracking-[0.12em] leading-tight">
            Witch Daddy
          </p>
          <p className="text-[7px] font-medium text-zinc-600 uppercase tracking-[0.2em]">
            Labs
          </p>
        </div>
      </div>
    </aside>
  );
}
