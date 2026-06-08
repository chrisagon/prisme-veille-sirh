/**
 * Listes de mots-clés et helpers de matching pour le scoring composite.
 * Cf. _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-3)
 * Cf. _bmad-output/implementation-artifacts/2-3-scoring-de-pertinence-composite.md
 *
 * - `SIRH_IA_KEYWORDS` : vocabulaire éditorial cible (FR). 40+ entrées.
 *   Match accent-insensitive + word-boundary strict.
 * - `PROMO_MARKERS` : signatures de contenu promotionnel. 10 entrées FR.
 *   Match accent-insensitive + word-boundary strict (≤ 7 chars) ou phrase.
 *
 * Anti-hallucination (C0) : aucune génération. Comptage pur.
 */

/** Mots-clés du domaine SIRH/IA. 40+ entrées, scope = veille FR. */
export const SIRH_IA_KEYWORDS: readonly string[] = [
  // Cœur SIRH
  "SIRH", "paie", "GPEC", "GEPP", "ATS", "TMS", "QVT", "RPS",
  "recrutement", "formation", "entretien annuel", "évaluation",
  "talents", "marque employeur", "onboarding", "offboarding",
  "mobilité interne", "diversité", "inclusion", "bien-être au travail",
  "absentéisme", "turnover", "RSE", "droit social", "télétravail",
  "hybrid work", "SaaS RH", "People Analytics", "HR Tech", "HRC",
  // IA
  "intelligence artificielle", "IA", "machine learning", "deep learning",
  "générative", "LLM", "agent IA", "chatbot RH", "automation RH",
  // Réglementaire
  "IA Act", "RGPD", "CNIL",
];

/** Markers de contenu promotionnel. 10 entrées FR. */
export const PROMO_MARKERS: readonly string[] = [
  "nous proposons",
  "contactez-nous",
  "demandez une démo",
  "solution clé en main",
  "gratuit",
  "offre limitée",
  "essai gratuit",
  "réduction exclusive",
  "abonnez-vous",
  "téléchargez maintenant",
];

/**
 * Seuil de longueur pour word-boundary strict. Tout terme ≤ ce seuil reçoit
 * un word-boundary ASCII (`\b…\b`) après normalisation NFD pour éviter les
 * faux positifs de concaténation (ex: "gratuit" dans "gratuitement",
 * "marque employeur" dans "marque employeurX").
 */
const WORD_BOUNDARY_MAX_LENGTH = 7;

/**
 * Construit le Set des mots devant recevoir un word-boundary strict
 * à partir d'une liste de keywords/markers. Calculé à chaque appel pour
 * rester cohérent avec le paramètre (pas de dépendance à l'état module).
 */
function buildWordBoundarySet(
  terms: readonly string[],
): Set<string> {
  const set = new Set<string>();
  for (const raw of terms) {
    const normalized = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
    if (normalized.length > 0 && normalized.length <= WORD_BOUNDARY_MAX_LENGTH) {
      set.add(raw);
    }
  }
  return set;
}

/**
 * Normalise un texte pour matching accent-insensitive + case-insensitive.
 * - NFD + strip des diacritics (é ≡ e, à ≡ a, ç ≡ c).
 * - lowercase.
 * - trim.
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Construit une RegExp avec word-boundary pour un mot-clé normalisé.
 * Le word-boundary est ASCII (`\b`) car la version normalisée n'a plus de diacritics.
 */
function buildWordBoundaryRegex(normalizedKeyword: string): RegExp {
  // Échapper les caractères spéciaux regex du mot-clé.
  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "g");
}

/**
 * Compte le nombre de keywords uniques trouvés dans un texte.
 *
 * - Case-insensitive.
 * - Accent-insensitive ("évaluation" matche "evaluation").
 * - Word-boundary strict pour les termes courts (≤ 7 chars) : "gratuit" ne
 *   matche PAS "gratuitement", "marque employeur" ne matche PAS "marque employeurX".
 * - Substring case-insensitive pour les phrases longues (> 7 chars).
 *
 * @returns liste des keywords distincts trouvés.
 */
export function countKeywordMatches(text: string, keywords: readonly string[]): string[] {
  if (!text || keywords.length === 0) return [];
  const normalized = normalizeText(text);
  const shortSet = buildWordBoundarySet(keywords);
  const found = new Set<string>();
  for (const raw of keywords) {
    const normalizedKeyword = normalizeText(raw);
    if (normalizedKeyword.length === 0) continue;
    let matched = false;
    if (shortSet.has(raw)) {
      // Word-boundary strict.
      const re = buildWordBoundaryRegex(normalizedKeyword);
      matched = re.test(normalized);
    } else {
      // Substring pour phrases/mots longs.
      matched = normalized.includes(normalizedKeyword);
    }
    if (matched) found.add(raw);
  }
  return Array.from(found);
}

/**
 * Compte le nombre de markers promotionnels trouvés dans un texte.
 *
 * - Case-insensitive.
 * - Accent-insensitive.
 * - Word-boundary strict pour les markers courts (≤ 7 chars, ex: "gratuit")
 *   pour éviter les faux positifs sur adverbes ("gratuitement") et dérivés.
 * - Substring pour les phrases longues (ex: "contactez-nous aujourd'hui",
 *   "recontactez-nous" matche "contactez-nous").
 *
 * @returns liste des markers distincts trouvés.
 */
export function countPromoMarkers(text: string, markers: readonly string[]): string[] {
  if (!text || markers.length === 0) return [];
  const normalized = normalizeText(text);
  const shortSet = buildWordBoundarySet(markers);
  const found: string[] = [];
  for (const raw of markers) {
    const normalizedMarker = normalizeText(raw);
    if (normalizedMarker.length === 0) continue;
    let matched = false;
    if (shortSet.has(raw)) {
      const re = buildWordBoundaryRegex(normalizedMarker);
      matched = re.test(normalized);
    } else {
      matched = normalized.includes(normalizedMarker);
    }
    if (matched) found.push(raw);
  }
  return found;
}
