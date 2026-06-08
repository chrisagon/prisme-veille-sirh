import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { X, Save } from "lucide-react";
import { VeilleSource, SourceType, ScanFrequency } from "../../types/veille";

interface Props {
  source: VeilleSource | null;
  mode: "edit" | "create";
  onClose: () => void;
  onSave: (source: VeilleSource) => void;
  createNew?: (name: string, url: string, type: SourceType) => VeilleSource;
}

const SOURCE_TYPES: SourceType[] = ["rss", "sitemap", "api"];
const SCAN_FREQUENCIES: ScanFrequency[] = ["daily", "weekly", "custom"];

export function SourceEditModal({ source, mode, onClose, onSave, createNew }: Props) {
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [type, setType] = useState<SourceType>(source?.type ?? "rss");
  const [keywordsText, setKeywordsText] = useState(
    (source?.keywords ?? []).join("\n"),
  );
  const [categoriesText, setCategoriesText] = useState(
    (source?.categories ?? []).join("\n"),
  );
  const [scanFrequency, setScanFrequency] = useState<ScanFrequency>(
    source?.scanFrequency ?? "weekly",
  );
  const [cronExpression, setCronExpression] = useState(
    source?.cronExpression ?? "",
  );
  const [reliabilityScore, setReliabilityScore] = useState<number>(
    source?.reliabilityScore ?? 85,
  );
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState(source?.apiKeyEnvVar ?? "");
  const [error, setError] = useState<string | null>(null);

  // Fermeture Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setError("Le nom est requis.");
      return;
    }
    if (!trimmedUrl) {
      setError("L'URL est requise.");
      return;
    }
    if (reliabilityScore < 0 || reliabilityScore > 100) {
      setError("Le score de fiabilité doit être entre 0 et 100.");
      return;
    }

    const keywords = keywordsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const categories = categoriesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    let final: VeilleSource;
    if (mode === "create" && createNew) {
      final = createNew(trimmedName, trimmedUrl, type);
      final.keywords = keywords;
      final.categories = categories;
      final.scanFrequency = scanFrequency;
      final.cronExpression = scanFrequency === "custom" ? cronExpression : undefined;
      final.reliabilityScore = reliabilityScore;
      final.apiKeyEnvVar = type === "api" ? apiKeyEnvVar : undefined;
    } else if (source) {
      final = {
        ...source,
        name: trimmedName,
        url: trimmedUrl,
        type,
        keywords,
        categories,
        scanFrequency,
        cronExpression: scanFrequency === "custom" ? cronExpression : undefined,
        reliabilityScore,
        apiKeyEnvVar: type === "api" ? apiKeyEnvVar : undefined,
      };
    } else {
      setError("État incohérent.");
      return;
    }

    onSave(final);
  };

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
      aria-labelledby="source-edit-modal-title"
    >
      <motion.form
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg p-5 flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-center justify-between border-b border-slate-700 pb-2">
          <h3
            id="source-edit-modal-title"
            className="text-sm font-bold text-slate-100 uppercase tracking-wide"
          >
            {mode === "create" ? "Ajouter une source" : "Éditer la source"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 p-1 transition"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {error && (
          <div className="bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-2 rounded-lg text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nom" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green"
              required
            />
          </Field>
          <Field label="Type" required>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SourceType)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="URL" required>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green font-mono"
            required
          />
        </Field>

        {type === "api" && (
          <Field label="Variable d'env pour la clé API" hint="ex: NEWSAPI_KEY">
            <input
              type="text"
              value={apiKeyEnvVar}
              onChange={(e) => setApiKeyEnvVar(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green font-mono"
              placeholder="NEWSAPI_KEY"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fréquence de scan" required>
            <select
              value={scanFrequency}
              onChange={(e) => setScanFrequency(e.target.value as ScanFrequency)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green"
            >
              {SCAN_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fiabilité (0-100)" required>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              inputMode="numeric"
              value={reliabilityScore}
              onChange={(e) => setReliabilityScore(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green font-mono"
            />
          </Field>
        </div>

        {scanFrequency === "custom" && (
          <Field label="Expression CRON" hint="ex: 0 8 * * 1">
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green font-mono"
              placeholder="0 8 * * 1"
            />
          </Field>
        )}

        <Field label="Mots-clés (1 par ligne)">
          <textarea
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green font-mono"
            placeholder={"SIRH\nrecrutement\npaie"}
          />
        </Field>

        <Field label="Catégories (1 par ligne)">
          <textarea
            value={categoriesText}
            onChange={(e) => setCategoriesText(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-hr-green"
          />
        </Field>

        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 border border-slate-700 rounded-lg transition"
          >
            Annuler
          </button>
          <button
            type="submit"
            className="bg-hr-green/20 hover:bg-hr-green/30 text-hr-green border border-hr-green/30 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Save className="w-3.5 h-3.5" />
            Enregistrer
          </button>
        </footer>
      </motion.form>
    </motion.div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-[10px] text-slate-500 italic">{hint}</span>}
    </label>
  );
}
