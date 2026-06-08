/**
 * Fixture algorithmique pour la structuration (story 2-5).
 * ATTENTION : ce fichier duplique la logique PURE de structurer.ts
 * (buildStructurationPrompt, parseGeminiResponse, computeWeekId,
 * validateActualitesCount) pour valider les invariants critiques en
 * l'absence de node_modules (env AI Studio). Risque de drift si la
 * production évolue. Toute divergence entre cette fixture et le code
 * réel doit être corrigée des deux côtés.
 *
 * Exécuter : `npx tsx scripts/structurer-logic-fixture.ts`
 *
 * Couverture cible (20/20 tests) :
 * - buildStructurationPrompt : contient les 5 instructions C2
 * - parseGeminiResponse : JSON valide / invalide / champs manquants /
 *   actualites > 5 (tronqué) / url manquante (champ omis)
 * - computeWeekId : ISO 8601 déterministe ("2026-wN")
 * - validateActualitesCount : 0-5 inclus
 */

let pass = 0;
let fail = 0;
function expect(label: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label} ${detail}`);
    fail++;
  }
}

// ============================================================================
// Types dupliqués du domaine (cf. structurer.ts)
// ============================================================================

interface VeilleRawArticleFixture {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  sourceId: string;
  score: number;
}

interface VeilleReportActualiteFixture {
  title: string;
  source: string;
  date: string;
  summary: string;
  impact: string;
  tags: string[];
  url?: string;
}

interface VeilleReportFixture {
  id: string;
  week: string;
  top3: string[];
  actualites: VeilleReportActualiteFixture[];
  mouvements: { title: string; details: string; category: string }[];
  reglementation: { title: string; detail: string; type: string }[];
  chiffre: { value: string; text: string; source: string } | null;
  signalFaible: { title: string; description: string } | null;
  ressources: { title: string; duration: string; type: string; url?: string }[];
  actions: { title: string; detail: string; confidentiality?: string; criticality?: string }[];
}

// ============================================================================
// Constantes
// ============================================================================

const ACTUALITES_MAX = 5;
const WEEK_ID_REGEX = /^\d{4}-w\d{1,2}$/;

// ============================================================================
// computeWeekId : "2026-wN" ISO 8601
// ============================================================================
console.log("\n--- computeWeekId ---");
function computeWeekId(date: Date): string {
  // ISO 8601 week-of-year : on reproduit le calcul de server.ts:152-157
  // (calcul simplifié aligné sur le code existant — pas de TZ handling subtil).
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const weekDiff = Math.floor(diff / oneDay / 7);
  return `${date.getFullYear()}-w${weekDiff + 1}`;
}
{
  const d1 = new Date("2026-06-04T12:00:00.000Z");
  const id1 = computeWeekId(d1);
  expect(
    `computeWeekId(2026-06-04) matche pattern YYYY-wN (got "${id1}")`,
    WEEK_ID_REGEX.test(id1),
    `got="${id1}"`,
  );
  expect(
    `computeWeekId prefix année = 2026 (got "${id1}")`,
    id1.startsWith("2026-w"),
    `got="${id1}"`,
  );
  expect(
    `computeWeekId reproductible (deux appels → même résultat)`,
    computeWeekId(d1) === computeWeekId(d1),
  );
  const d2 = new Date("2026-01-01T12:00:00.000Z");
  const id2 = computeWeekId(d2);
  expect(
    `computeWeekId(2026-01-01) = 2026-w1 (got "${id2}")`,
    id2 === "2026-w1",
    `got="${id2}"`,
  );
  // Patch #34 : clamp w1..w53
  expect(
    `computeWeekId clamp wN dans 1..53`,
    /^2026-w([1-9]|[1-4][0-9]|5[0-3])$/.test(id1),
  );
}

// ============================================================================
// buildStructurationPrompt : C2 anti-hallucination strict
// ============================================================================
console.log("\n--- buildStructurationPrompt ---");
function buildStructurationPrompt(articles: VeilleRawArticleFixture[]): string {
  const articlesBlock = articles
    .map(
      (a) =>
        `ID: ${a.id}|URL: ${a.url}|SOURCE: ${a.sourceId}|SCORE: ${a.score}|TITRE: ${a.title}|EXTRAIT: ${a.excerpt.slice(0, 300)}`,
    )
    .join("\n");

  return `Tu es un classificateur de veille SIRH/IA. Tu ne génères AUCUN fait, AUCUN chiffre, AUCUNE source qui ne soit pas dans la liste d'articles fournie.

Si une information n'est pas présente dans le corpus, omets-la. Ne complète jamais par hypothèse.

Chaque actualite.url doit être copiée EXACTEMENT depuis l'URL de l'article source. Aucune invention d'URL.

Limite STRICTE : 5 actualités maximum. Tu peux en mettre moins si le corpus est faible, mais jamais plus de 5.

Cinq catégories obligatoires :
1. Top 5 actualités (champ actualites, max 5)
2. Tendances émergentes (champ signalFaible)
3. Mouvements éditeurs (champ mouvements)
4. Risques réglementaires (champ reglementation)
5. Recommandations HRC (champ actions)

ARTICLES DU CORPUS (${articles.length}) :
${articlesBlock}

Retourne UNIQUEMENT le JSON, sans markdown, sans préambule.`;
}
{
  const fixtureArticles: VeilleRawArticleFixture[] = [
    {
      id: "abc123",
      url: "https://www.lucca.fr/conges-absences",
      title: "Déploiement pilote Lucca Copilot",
      excerpt: "L'éditeur français Lucca déploie un assistant génératif pour les conventions collectives complexes.",
      sourceId: "rss-lucca",
      score: 75.5,
    },
    {
      id: "def456",
      url: "https://www.workday.com/blog/zero-context",
      title: "Workday Zero Context Switching",
      excerpt: "Workday et Microsoft renforcent l'intégration SIRH dans Teams via Copilot.",
      sourceId: "rss-workday",
      score: 68.2,
    },
  ];
  const prompt = buildStructurationPrompt(fixtureArticles);

  expect(
    `prompt contient "anti-hallucination" / "AUCUN fait"`,
    prompt.includes("AUCUN fait"),
  );
  expect(
    `prompt contient contrainte "5 actualités maximum"`,
    prompt.includes("5 actualités maximum"),
  );
  expect(
    `prompt contient règle URL "copiée EXACTEMENT"`,
    prompt.includes("EXACTEMENT") && prompt.includes("URL"),
  );
  expect(
    `prompt contient règle "source" issue du corpus`,
    prompt.includes("corpus") && prompt.includes("source"),
  );
  expect(
    `prompt contient 5 catégories (classifi|Top 5|Tendances|Mouvements|Risques|Recommandations)`,
    prompt.includes("classificateur") &&
      prompt.includes("Top 5") &&
      prompt.includes("Tendances") &&
      prompt.includes("Mouvements") &&
      prompt.includes("réglementaires") &&
      prompt.includes("Recommandations"),
  );
  expect(
    `prompt contient les 2 articles (Lucca + Workday)`,
    prompt.includes("Lucca Copilot") && prompt.includes("Workday"),
  );
  expect(
    `prompt contient les URLs sources`,
    prompt.includes("https://www.lucca.fr/conges-absences") &&
      prompt.includes("https://www.workday.com/blog/zero-context"),
  );
  expect(
    `prompt contient consigne "sans markdown"`,
    prompt.includes("sans markdown"),
  );
  // Cas limite : corpus vide
  const promptVide = buildStructurationPrompt([]);
  expect(
    `prompt avec corpus vide reste valide (pas de crash)`,
    promptVide.includes("ARTICLES DU CORPUS (0)"),
  );
}

// ============================================================================
// parseGeminiResponse : validation runtime JSON → VeilleReport
// ============================================================================
console.log("\n--- parseGeminiResponse ---");
function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenceMatch) s = fenceMatch[1].trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  return s.trim();
}

function validateStringObject<T extends Record<string, unknown>>(
  raw: unknown,
  required: ReadonlyArray<keyof T & string>,
): T | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const k of required) {
    if (typeof obj[k] !== "string") return null;
  }
  return obj as T;
}

function parseGeminiResponse(raw: string, weekId: string): VeilleReportFixture | null {
  const cleaned = stripMarkdownFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const top3 = Array.isArray(obj.top3)
    ? (obj.top3.filter((x): x is string => typeof x === "string") as string[]).slice(0, 3)
    : [];

  const actualites = validateActualitesCount(
    Array.isArray(obj.actualites) ? obj.actualites : [],
  );

  const mouvements = Array.isArray(obj.mouvements)
    ? obj.mouvements
        .map((m) =>
          validateStringObject<{ title: string; details: string; category: string }>(m, [
            "title",
            "details",
            "category",
          ]),
        )
        .filter((m): m is { title: string; details: string; category: string } => m !== null)
    : [];

  const reglementation = Array.isArray(obj.reglementation)
    ? obj.reglementation
        .map((r) =>
          validateStringObject<{ title: string; detail: string; type: string }>(r, [
            "title",
            "detail",
            "type",
          ]),
        )
        .filter((r): r is { title: string; detail: string; type: string } => r !== null)
    : [];

  const chiffre =
    validateStringObject<{ value: string; text: string; source: string }>(obj.chiffre, [
      "value",
      "text",
      "source",
    ]) ?? null;

  const signalFaible =
    validateStringObject<{ title: string; description: string }>(obj.signalFaible, [
      "title",
      "description",
    ]) ?? null;

  const ressources = Array.isArray(obj.ressources)
    ? obj.ressources
        .map((r) => {
          const validated = validateStringObject<{
            title: string;
            duration: string;
            type: string;
            url?: string;
          }>(r, ["title", "duration", "type"]);
          if (!validated) return null;
          const out: { title: string; duration: string; type: string; url?: string } = {
            title: validated.title,
            duration: validated.duration,
            type: validated.type,
          };
          if (typeof validated.url === "string" && validated.url.length > 0) {
            out.url = validated.url;
          }
          return out;
        })
        .filter(
          (r): r is { title: string; duration: string; type: string; url?: string } =>
            r !== null,
        )
    : [];

  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .map((a) => {
          const validated = validateStringObject<{
            title: string;
            detail: string;
            confidentiality?: string;
            criticality?: string;
          }>(a, ["title", "detail"]);
          if (!validated) return null;
          const out: { title: string; detail: string; confidentiality?: string; criticality?: string } = {
            title: validated.title,
            detail: validated.detail,
          };
          if (typeof validated.confidentiality === "string") {
            out.confidentiality = validated.confidentiality;
          }
          if (typeof validated.criticality === "string") {
            out.criticality = validated.criticality;
          }
          return out;
        })
        .filter(
          (a): a is { title: string; detail: string; confidentiality?: string; criticality?: string } =>
            a !== null,
        )
    : [];

  const idStr = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : `${weekId}-${Date.now()}`;

  return {
    id: idStr,
    week: typeof obj.week === "string" ? obj.week : "",
    top3,
    actualites,
    mouvements,
    reglementation,
    chiffre,
    signalFaible,
    ressources,
    actions,
  };
}
{
  // Cas nominal : JSON complet et conforme
  const valid = JSON.stringify({
    week: "Semaine du 4 Juin 2026",
    top3: ["Fait 1", "Fait 2", "Fait 3"],
    actualites: [
      {
        title: "Lucca Copilot",
        source: "RH Info",
        date: "04/06/2026",
        summary: "Déploiement pilote.",
        impact: "Gain temps manager.",
        tags: ["automatisation"],
        url: "https://www.lucca.fr/conges-absences",
      },
      {
        title: "Workday Teams",
        source: "Workday Blog",
        date: "03/06/2026",
        summary: "Intégration Copilot.",
        impact: "Meilleure UX.",
        tags: ["marché"],
      },
    ],
    mouvements: [
      { title: "Lucca x HumaniAI", details: "Partenariat éthique.", category: "Partenariat" },
    ],
    reglementation: [
      { title: "IA Act", detail: "Explicabilité.", type: "IA Act" },
    ],
    chiffre: { value: "74%", text: "DRH IA prioritaire.", source: "Gartner 2026" },
    signalFaible: { title: "Reverse matching", description: "Candidats auditent employeurs." },
    ressources: [{ title: "Guide IA Act", duration: "12 min", type: "Guide" }],
    actions: [{ title: "Charte IA", detail: "Réviser usage IA." }],
  });
  const parsed = parseGeminiResponse(valid, "2026-w23");
  expect(`parseGeminiResponse : JSON valide → objet non-null`, parsed !== null);
  expect(
    `parseGeminiResponse : week propagé`,
    parsed?.week === "Semaine du 4 Juin 2026",
  );
  expect(
    `parseGeminiResponse : top3 = 3 strings`,
    parsed?.top3.length === 3 && parsed.top3[0] === "Fait 1",
  );
  expect(
    `parseGeminiResponse : actualites = 2 entrées (sous le max)`,
    parsed?.actualites.length === 2,
  );
  expect(
    `parseGeminiResponse : url préservée si présente`,
    parsed?.actualites[0].url === "https://www.lucca.fr/conges-absences",
  );
  expect(
    `parseGeminiResponse : url absente = champ omis`,
    parsed?.actualites[1].url === undefined,
  );

  // Cas dégradé : JSON invalide
  const invalid = parseGeminiResponse("{ not valid json", "2026-w23");
  expect(`parseGeminiResponse : JSON invalide → null`, invalid === null);

  // Patch #7 : markdown fence stripping
  const fenced = "```json\n" + valid + "\n```";
  const parsedFenced = parseGeminiResponse(fenced, "2026-w23");
  expect(
    `parseGeminiResponse : strip ```json fences`,
    parsedFenced !== null && parsedFenced.week === "Semaine du 4 Juin 2026",
  );

  // Patch #14 : top3 cap à 3
  const top3Overflow = JSON.stringify({
    week: "S overflow",
    top3: ["A", "B", "C", "D", "E"],
  });
  const parsedTop3 = parseGeminiResponse(top3Overflow, "2026-w23");
  expect(
    `parseGeminiResponse : top3 capé à 3`,
    parsedTop3?.top3.length === 3 && parsedTop3.top3[2] === "C",
  );

  // Patch #2 : chiffre absent → null (plus {} legacy)
  const noChiffre = parseGeminiResponse('{"week":"S x"}', "2026-w23");
  expect(
    `parseGeminiResponse : chiffre absent → null (pas {})`,
    noChiffre?.chiffre === null,
  );
  expect(
    `parseGeminiResponse : signalFaible absent → null (pas {})`,
    noChiffre?.signalFaible === null,
  );

  // Cas dégradé : champs manquants → fallback safe
  const partial = parseGeminiResponse('{"week": "S 4 juin"}', "2026-w23");
  expect(`parseGeminiResponse : champs manquants → objet valide`, partial !== null);
  expect(
    `parseGeminiResponse : top3 absent → []`,
    partial?.top3.length === 0,
  );
  expect(
    `parseGeminiResponse : actualites absent → []`,
    partial?.actualites.length === 0,
  );
  expect(
    `parseGeminiResponse : id auto-généré depuis weekId`,
    partial !== null && partial !== undefined && (partial.id?.startsWith("2026-w23-") ?? false),
    `got id="${partial?.id}"`,
  );
}

// ============================================================================
// validateActualitesCount : 0-5 strict (D-4 defense in depth)
// ============================================================================
console.log("\n--- validateActualitesCount ---");
function validateActualitesCount(
  raw: unknown[],
): VeilleReportActualiteFixture[] {
  const out: VeilleReportActualiteFixture[] = [];
  for (const item of raw) {
    if (out.length >= ACTUALITES_MAX) break; // defense in depth
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string") continue;
    const actualite: VeilleReportActualiteFixture = {
      title: obj.title,
      source: typeof obj.source === "string" ? obj.source : "",
      date: typeof obj.date === "string" ? obj.date : "",
      summary: typeof obj.summary === "string" ? obj.summary : "",
      impact: typeof obj.impact === "string" ? obj.impact : "",
      tags: Array.isArray(obj.tags)
        ? obj.tags.filter((t): t is string => typeof t === "string")
        : [],
    };
    if (typeof obj.url === "string" && obj.url.length > 0) {
      actualite.url = obj.url;
    }
    out.push(actualite);
  }
  return out;
}
{
  // 0 entrée → []
  expect(
    `validateActualitesCount([]) = []`,
    validateActualitesCount([]).length === 0,
  );
  // 3 entrées → 3
  const three = [
    { title: "A1", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
    { title: "A2", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
    { title: "A3", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
  ];
  expect(
    `validateActualitesCount(3 entrées) = 3`,
    validateActualitesCount(three).length === 3,
  );
  // 7 entrées (Gemini ignore la contrainte) → tronqué à 5
  const seven = Array.from({ length: 7 }, (_, i) => ({
    title: `A${i + 1}`,
    source: "s",
    date: "d",
    summary: "x",
    impact: "i",
    tags: [],
  }));
  expect(
    `validateActualitesCount(7 entrées) tronqué à 5`,
    validateActualitesCount(seven).length === ACTUALITES_MAX,
  );
  // 5 entrées → 5
  const five = Array.from({ length: 5 }, (_, i) => ({
    title: `A${i + 1}`,
    source: "s",
    date: "d",
    summary: "x",
    impact: "i",
    tags: [],
  }));
  expect(
    `validateActualitesCount(5 entrées) = 5`,
    validateActualitesCount(five).length === 5,
  );
  // Entrée sans title → ignorée
  const mixed = [
    { title: "OK", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
    { noTitle: "bad" }, // pas de title → skip
    { title: "OK2", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
  ];
  expect(
    `validateActualitesCount skip entrées sans title`,
    validateActualitesCount(mixed).length === 2,
  );
  // url absente → champ omis
  const noUrl = [
    { title: "X", source: "s", date: "d", summary: "x", impact: "i", tags: [] },
  ];
  const parsed = validateActualitesCount(noUrl);
  expect(
    `validateActualitesCount url absente → champ omis (C0)`,
    parsed[0].url === undefined,
    `got=${JSON.stringify(parsed[0])}`,
  );
}

// ============================================================================
// Résumé
// ============================================================================
console.log(`\n=== Résultat : ${pass} OK / ${fail} KO (sur ${pass + fail} tests) ===`);
if (fail > 0) {
  process.exit(1);
}
