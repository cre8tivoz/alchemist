import { X, Shield, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CloudConsentModalProps {
  onClose: () => void;
  onConsent: () => void;
  onRevoke: () => void;
  hasConsented: boolean;
}

const dataPoints = [
  {
    label: "Table & column names",
    detail: "Sent to generate accurate queries against your schema",
    shared: true,
  },
  {
    label: "Column types & constraints",
    detail: "Used to produce type-safe SQL",
    shared: true,
  },
  {
    label: "Foreign key relationships",
    detail: "For correct JOIN generation",
    shared: true,
  },
  {
    label: "Row count estimates",
    detail: "Helps the model decide LIMIT and filtering strategies",
    shared: false,
  },
  {
    label: "Actual row data",
    detail: "Never sent. Your data stays local.",
    shared: false,
  },
  {
    label: "API keys or credentials",
    detail: "Never sent. Stored in your system keychain.",
    shared: false,
  },
];

export function CloudConsentModal({
  onClose,
  onConsent,
  onRevoke,
  hasConsented,
}: CloudConsentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-white/[0.1] bg-[#0d0d14] shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            Cloud Provider Consent
          </h2>
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
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 px-3 py-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              When using cloud AI providers (OpenAI, DeepSeek, Google AI Studio), some metadata about your
              database schema is sent to their servers to generate accurate
              queries. Your actual data never leaves your machine.
            </p>
          </div>

          {/* Data sharing details */}
          <div>
            <h3 className="text-xs font-medium text-zinc-400 mb-2.5">
              What gets shared:
            </h3>
            <div className="space-y-1.5">
              {dataPoints.map((dp) => (
                <div
                  key={dp.label}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/[0.02]"
                >
                  <div
                    className={cn(
                      "w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      dp.shared
                        ? "bg-violet-500/15 text-violet-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    )}
                  >
                    <Check className="w-2.5 h-2.5" />
                  </div>
                  <div className="flex-1">
                    <p
                      className={cn(
                        "text-xs",
                        dp.shared ? "text-zinc-300" : "text-zinc-500"
                      )}
                    >
                      {dp.label}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {dp.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Privacy mode note */}
          <p className="text-xs text-zinc-600 leading-relaxed">
            You can adjust how much schema context is shared in your privacy
            settings. Your actual data, API keys, and credentials are always
            kept local.
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
          {hasConsented && (
            <Button
              variant="outline"
              onClick={onRevoke}
              className="h-9 px-4 rounded-lg text-xs font-medium border-red-500/20 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              Revoke Consent
            </Button>
          )}
          <Button
            onClick={onConsent}
            className={cn(
              "h-9 px-5 rounded-lg text-xs font-medium",
              hasConsented
                ? "bg-zinc-700 text-zinc-400 cursor-default"
                : "bg-violet-600 hover:bg-violet-500 text-white"
            )}
          >
            {hasConsented ? "Already Consented" : "I Understand"}
          </Button>
        </div>
      </div>
    </div>
  );
}
