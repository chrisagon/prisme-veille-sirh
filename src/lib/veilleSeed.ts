import { collection, getCountFromServer, writeBatch, doc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import {
  VeilleSource,
  DEFAULT_RELIABILITY_HIGH,
  DEFAULT_RELIABILITY_MEDIUM,
} from "../types/veille";

/**
 * Catalogue initial des 9 sources RSS primaires.
 * Source : _bmad-output/specs/spec-veille-automatique/sources-donnees.md
 * `lastScanAt: null` à l'init, `scanFrequency: 'weekly'` par défaut.
 */
export const PRIMARY_RSS_SOURCES: VeilleSource[] = [
  {
    id: "actuel-rh",
    name: "ActuEL-RH",
    url: "https://www.actuel-rh.fr/rss",
    type: "rss",
    keywords: ["SIRH", "RH", "recrutement", "paie"],
    categories: ["général", "recrutement", "paie"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "parlons-rh",
    name: "Parlons RH",
    url: "https://www.parlonsrh.com/flux-rss/",
    type: "rss",
    keywords: ["SIRH", "digital", "actualités RH"],
    categories: ["actualités RH", "SIRH", "digital"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "centre-inffo",
    name: "Centre Inffo",
    url: "https://www.centre-inffo.fr/centre-inffo/nos-flux-rss",
    type: "rss",
    keywords: ["formation", "CPF", "droit formation"],
    categories: ["formation", "CPF", "droit formation"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "rh-info-adp",
    name: "RH Info (ADP)",
    url: "https://www.fr.adp.com/rhinfo.aspx",
    type: "sitemap",
    keywords: ["management", "SIRH", "paie"],
    categories: ["management", "SIRH", "paie"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_MEDIUM,
  },
  {
    id: "rh-matin",
    name: "RH Matin",
    url: "https://www.rhmatin.com/",
    type: "sitemap",
    keywords: ["SIRH", "recrutement", "digital learning"],
    categories: ["SIRH", "recrutement", "digital learning"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "news-tank-rh",
    name: "News Tank RH",
    url: "https://rh.newstank.fr",
    type: "sitemap",
    keywords: ["veille stratégique", "politique emploi"],
    categories: ["veille stratégique", "politique emploi"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "edrh",
    name: "EDRH",
    url: "https://edrh.fr/flux-rss",
    type: "rss",
    keywords: ["mobilités", "qualifications"],
    categories: ["mobilités", "évolution qualifications"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "liaisons-sociales",
    name: "Liaisons Sociales",
    url: "https://www.liaisons-sociales.fr/",
    type: "sitemap",
    keywords: ["droit social", "jurisprudence"],
    categories: ["droit social", "jurisprudence"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
  {
    id: "dares",
    name: "DARES",
    url: "https://dares.travail-emploi.gouv.fr/",
    type: "api",
    keywords: ["emploi", "études RH"],
    categories: ["emploi", "études RH"],
    active: true,
    lastScanAt: null,
    scanFrequency: "weekly",
    reliabilityScore: DEFAULT_RELIABILITY_HIGH,
  },
];

/**
 * Insère les 9 sources primaires dans `veille_sources` si et seulement
 * si la collection est vide côté serveur. Idempotent.
 */
export async function seedVeilleSourcesIfEmpty(): Promise<void> {
  try {
    const colRef = collection(db, "veille_sources");
    const snapshot = await getCountFromServer(colRef);
    if (snapshot.data().count > 0) {
      return;
    }
    const batch = writeBatch(db);
    for (const source of PRIMARY_RSS_SOURCES) {
      // lastScanAt est `null` à l'init : on omet le champ Timestamp.
      // Firestore refusera `null` pour un Timestamp, donc on retire la clé.
      const { lastScanAt: _lastScanAt, ...payload } = source;
      void _lastScanAt;
      batch.set(doc(colRef, source.id), payload);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "veille_sources (seed)");
  }
}
