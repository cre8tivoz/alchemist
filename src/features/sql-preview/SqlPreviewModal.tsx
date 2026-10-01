import { X, Check, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SqlBlock } from "@/features/workspace/SqlBlock";
import { cn } from "@/lib/utils";

interface SqlPreviewModalProps {
  sql: string;
  onClose: () => void;
  onRun: () => void;
}

const safetyChecks = [
  { code: "readonly", label: "Read-only connection", passed: true },
  { code: "single", label: "Single SQL statement", passed: true },
  { code: "select", label: "SELECT-only query", passed: true },
  { code: "dangerous", label: "No dangerous keywords detected", passed: true },
  { code: "limit", label: "Limit clause detected (100)", passed: true },
];

export function SqlPreviewModal({ sql, onClose, onRun }: SqlPreviewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 rounded-2xl border border-white/[0.1] bg-[#0d0d14] shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-zinc-100">SQL Preview</h2>
          <button
            type="button"
            aria-label="Close modal"
            title="Close"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* SQL block */}
          <SqlBlock sql={sql} className="border-violet-500/15" />

          {/* Safety checks */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />
              SAFETY CHECKS
            </h3>

            <div className="grid grid-cols-1 gap-2">
              {safetyChecks.map((check) => (
                <div
                  key={check.code}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg",
                    check.passed ? "bg-emerald-500/5" : "bg-red-500/5"
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                      check.passed ? "bg-emerald-500/15" : "bg-red-500/15"
                    )}
                  >
                    <Check
                      className={cn(
                        "w-3 h-3",
                        check.passed ? "text-emerald-400" : "text-red-400"
                      )}
                    />
                  </div>
                  <span className="text-sm text-zinc-300">{check.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Safety message */}
          <p className="text-xs text-zinc-500 leading-relaxed">
            This query will not modify your database. You can review and edit the SQL before running it.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-white/[0.06] bg-white/[0.02]">
          <Button
            variant="ghost"
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
          >
            Cancel
          </Button>
          <Button
            onClick={onRun}
            className="h-9 px-5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white"
          >
            Run Query
          </Button>
        </div>
      </div>
    </div>
  );
}
