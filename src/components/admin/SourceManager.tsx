import { useState, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import {
  Plus,
  Edit,
  Trash2,
  Database,
  X,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useVeilleSources, SyncState } from "../../hooks/useVeilleSources";
import { VeilleSource, SourceType, ScanFrequency } from "../../types/veille";
import { PRIMARY_RSS_SOURCES } from "../../lib/veilleSeed";
import { SourceEditModal } from "./SourceEditModal";
import { ConfirmModal } from "./ConfirmModal";

const PROTECTED_IDS: Set<string> = new Set(
  PRIMARY_RSS_SOURCES.map((s) => s.id),
);

const TYPE_BADGE: Record<SourceType, string> = {
  rss: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  sitemap: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  api: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

const FREQ_BADGE: Record<ScanFrequency, string> = {
  daily: "bg-emerald-500/20 text-emerald-300",
  weekly: "bg-cyan-500/20 text-cyan-300",
  custom: "bg-pink-500/20 text-pink-300",
};

function formatDate(ts: unknown): string {
  if (!ts) return "—";
  // Firestore Timestamp ou ISO string selon provenance
  const date =
    typeof ts === "object" && ts !== null && "toDate" in ts
      ? (ts as { toDate: () => Date }).toDate()
      : new Date(ts as string);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function SourceManager() {
  const { sources, loading, error, syncState, upsert, toggle, remove, refresh } =
    useVeilleSources();
  const [editing, setEditing] = useState<VeilleSource | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<VeilleSource | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showLocalToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [sources],
  );

  const handleSave = (source: VeilleSource) => {
    upsert(source);
    setEditing(null);
    setCreating(false);
    showLocalToast(`Source « ${source.name} » enregistrée.`);
  };

  const handleCreate = () => {
    setCreating(true);
    setEditing(null);
  };

  const handleToggle = (id: string) => {
    const src = sources.find((s) => s.id === id);
    if (!src) return;
    const nextActive = !src.active;
    toggle(id);
    showLocalToast(
      `Source « ${src.name} » ${nextActive ? "activée" : "désactivée"}.`,
    );
  };

  const handleRemove = (id: string) => {
    const src = sources.find((s) => s.id === id);
    remove(id);
    if (src) showLocalToast(`Source « ${src.name} » supprimée.`);
  };

  const handleNewSource = (name: string, url: string, type: SourceType): VeilleSource => {
    const id = `${slugify(name)}-${Date.now().toString(36)}`;
    return {
      id,
      name,
      url,
      type,
      keywords: [],
      categories: [],
      active: true,
      lastScanAt: null,
      scanFrequency: "weekly",
      reliabilityScore: 70,
    };
  };

  return (
    <section className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col gap-3 print-card">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-teal-400" />
          <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
            Sources de veille
          </h2>
          <SyncBadge
            loading={loading}
            error={error}
            count={sources.length}
            syncState={syncState}
          />
        </div>
        <button
          onClick={handleCreate}
          className="bg-hr-green/20 hover:bg-hr-green/30 text-hr-green border border-hr-green/30 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
          aria-label="Ajouter une source"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Ajouter une source</span>
        </button>
      </header>

      {error && (
        <div className="bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>⚠️ Erreur de chargement : {error.message}</span>
          <button
            onClick={refresh}
            className="underline hover:no-underline"
            aria-label="Réessayer"
          >
            Réessayer
          </button>
        </div>
      )}

      {loading || (error !== null && sources.length === 0) ? (
        <SkeletonRows />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 px-2 font-semibold">Nom</th>
                <th className="text-left py-2 px-2 font-semibold">Type</th>
                <th className="text-center py-2 px-2 font-semibold">Actif</th>
                <th className="text-left py-2 px-2 font-semibold">Dernier scan</th>
                <th className="text-right py-2 px-2 font-semibold">Fiabilité</th>
                <th className="text-left py-2 px-2 font-semibold">Fréquence</th>
                <th className="text-right py-2 px-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedSources.map((s) => {
                const isProtected = PROTECTED_IDS.has(s.id);
                return (
                  <tr
                    key={s.id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 transition"
                  >
                    <td className="py-2 px-2">
                      <div className="font-semibold text-slate-100">{s.name}</div>
                      <div className="text-slate-500 text-[10px] truncate max-w-xs">
                        {s.url}
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${TYPE_BADGE[s.type]}`}
                      >
                        {s.type}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => handleToggle(s.id)}
                        className="inline-flex"
                        aria-label={s.active ? "Désactiver" : "Activer"}
                      >
                        {s.active ? (
                          <ToggleRight className="w-5 h-5 text-hr-green" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-slate-500" />
                        )}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-slate-300 text-[11px]">
                      {formatDate(s.lastScanAt)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span
                        className={`font-mono font-bold ${
                          s.reliabilityScore >= 80
                            ? "text-hr-green"
                            : s.reliabilityScore >= 60
                              ? "text-amber-300"
                              : "text-red-300"
                        }`}
                      >
                        {s.reliabilityScore}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${FREQ_BADGE[s.scanFrequency]}`}
                      >
                        {s.scanFrequency}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditing(s);
                            setCreating(false);
                          }}
                          className="text-slate-400 hover:text-slate-100 p-1 transition"
                          aria-label={`Éditer ${s.name}`}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (!isProtected) setConfirmDelete(s);
                          }}
                          disabled={isProtected}
                          className={`p-1 transition ${
                            isProtected
                              ? "text-slate-700 cursor-not-allowed"
                              : "text-red-400 hover:text-red-300"
                          }`}
                          title={
                            isProtected
                              ? "Source du catalogue initial (protégée)"
                              : "Supprimer"
                          }
                          aria-label={`Supprimer ${s.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedSources.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 text-center text-slate-500 italic"
                  >
                    Aucune source. Cliquez sur "Ajouter une source" pour commencer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <SourceEditModal
            source={editing}
            mode="edit"
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
        {creating && (
          <SourceEditModal
            source={null}
            mode="create"
            onClose={() => setCreating(false)}
            onSave={handleSave}
            createNew={handleNewSource}
          />
        )}
        {confirmDelete && (
          <ConfirmModal
            title="Confirmer la suppression"
            message={`Supprimer définitivement la source "${confirmDelete.name}" ? Cette action est irréversible.`}
            confirmLabel="Supprimer"
            danger
            onConfirm={() => {
              handleRemove(confirmDelete.id);
              setConfirmDelete(null);
            }}
            onClose={() => setConfirmDelete(null)}
          />
        )}
      </AnimatePresence>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 bg-slate-800 border border-slate-700 text-slate-100 text-xs px-3 py-2 rounded-lg shadow-lg"
        >
          {toast}
        </div>
      )}
    </section>
  );
}

function SyncBadge({
  loading,
  error,
  count,
  syncState,
}: {
  loading: boolean;
  error: Error | null;
  count: number;
  syncState: SyncState;
}) {
  if (error) {
    return (
      <span
        aria-live="polite"
        className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-mono font-bold border border-red-500/30"
      >
        <X className="w-3 h-3 inline-block mr-0.5" />
        Erreur
      </span>
    );
  }
  if (loading || syncState === "syncing") {
    return (
      <span
        aria-live="polite"
        className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold border border-amber-500/30 flex items-center gap-1"
      >
        <RefreshCw className="w-3 h-3 animate-spin" />
        Synchronisation…
      </span>
    );
  }
  if (syncState === "error") {
    return (
      <span
        aria-live="polite"
        className="text-[10px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-mono font-bold border border-red-500/30"
      >
        <X className="w-3 h-3 inline-block mr-0.5" />
        Échec sync
      </span>
    );
  }
  return (
    <span
      aria-live="polite"
      className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-bold border border-emerald-500/30"
    >
      {count} synchronisée{count > 1 ? "s" : ""}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2" aria-label="Chargement">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-8 bg-slate-700/40 rounded animate-pulse"
        />
      ))}
    </div>
  );
}
