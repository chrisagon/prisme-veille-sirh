import { useEffect } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Trash2 } from "lucide-react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-3"
      >
        <header className="flex items-center gap-2">
          {danger ? (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          )}
          <h3
            id="confirm-modal-title"
            className="text-sm font-bold text-slate-100 uppercase tracking-wide"
          >
            {title}
          </h3>
        </header>

        <p className="text-xs text-slate-300 leading-relaxed">{message}</p>

        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded-lg transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
              danger
                ? "bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/40"
                : "bg-hr-green/20 hover:bg-hr-green/30 text-hr-green border-hr-green/30"
            }`}
          >
            {danger && <Trash2 className="w-3.5 h-3.5" />}
            {confirmLabel}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
