/**
 * Helpers HTTP pour le worker de scan.
 * Cf. _bmad-output/implementation-artifacts/2-1-worker-de-scan-periodique-configurable.md (AC #6, #7)
 *
 * Pattern `AbortController` + `setTimeout` repris de `server.ts:100-112` (rss-stats endpoint).
 * Pas de node-fetch : Node 18+ a `fetch` natif.
 *
 * - User-Agent : `PRISME-Bot/1.0` (STRICT, conforme spec — voir story #2-1, AC #6)
 *   Note : `server.ts:107` utilise `Mozilla/5.0 PRISME-Bot/1.0` (legacy), le scanner utilise STRICT.
 * - Timeout : 3500ms par défaut (override via env `SCAN_TIMEOUT_MS`)
 * - Rate limit : 1 req/sec/domaine (en mémoire, override via env `SCAN_RATE_LIMIT_MS`,
 *   plancher 100ms pour éviter DDoS)
 * - SSRF guard : bloque loopback / LAN / metadata cloud (cf. code review story 2-1)
 * - Cap body 5 MB + rejet Content-Type text/html (cf. code review story 2-1)
 */

import { randomUUID } from "node:crypto";

const DEFAULT_UA = "PRISME-Bot/1.0";
const DEFAULT_TIMEOUT_MS = 3500;
const MIN_RATE_LIMIT_MS = 100;
const DEFAULT_RATE_LIMIT_MS = 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT_HEADER =
  "application/rss+xml, application/xml, text/xml, application/json";
const HTML_ACCEPT_HEADER =
  "text/html, application/xhtml+xml";

// SSRF : hôtes privés / loopback / metadata cloud. Bloque fetch vers ces plages.
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "::1" || lower === "[::1]") return true;
  // IPv4 privées
  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number) as [number, number, number, number];
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 link-local + metadata cloud
  }
  // IPv6 privées (heuristique simple)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe80:")) return true; // link-local
  return false;
}

const USER_AGENT = process.env.SCAN_USER_AGENT || DEFAULT_UA;
const TIMEOUT_MS = Number.parseInt(
  process.env.SCAN_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
) || DEFAULT_TIMEOUT_MS;
const RAW_RATE_LIMIT_MS = Number.parseInt(
  process.env.SCAN_RATE_LIMIT_MS ?? String(DEFAULT_RATE_LIMIT_MS),
  10,
) || DEFAULT_RATE_LIMIT_MS;
const RATE_LIMIT_MS = Math.max(MIN_RATE_LIMIT_MS, RAW_RATE_LIMIT_MS);

const lastRequestPerHost = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Attend que le rate limiter 1 req/sec/domaine le permette.
 * Met à jour le timestamp lastRequest pour le host donné.
 */
async function waitForRateLimit(hostname: string): Promise<void> {
  const now = Date.now();
  const last = lastRequestPerHost.get(hostname) ?? 0;
  const delta = now - last;
  if (delta < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - delta);
  }
  lastRequestPerHost.set(hostname, Date.now());
}

/** Cap une lecture de body à MAX_BODY_BYTES, rejette si dépassé.
 * Lit en streaming via `Response.body` (ReadableStream) pour éviter le piège du
 * `Transfer-Encoding: chunked` où `Content-Length` est absent et `response.text()`
 * charge tout en RAM avant de pouvoir reject.
 */
async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new Error(`Body trop volumineux (${declared} > ${MAX_BODY_BYTES} octets)`);
    }
  }
  // Si le serveur n'a pas envoyé Content-Length (chunked), on doit streamer
  // borné pour ne pas charger plus de MAX_BODY_BYTES en RAM.
  if (!response.body) {
    // Fallback (rare, ex: Node <18 ou runtime custom) — assume bornage a priori.
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new Error(`Body trop volumineux après lecture (${text.length} > ${MAX_BODY_BYTES} octets)`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        throw new Error(`Body trop volumineux en streaming (${total} > ${MAX_BODY_BYTES} octets)`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

/**
 * Fetch avec timeout, User-Agent PRISME, rate limit par domaine,
 * SSRF guard (refuse loopback/LAN/metadata) et cap body 5 MB.
 * Lève une erreur si le statut HTTP n'est pas 2xx ou si la requête est annulée.
 *
 * Options :
 * - `headers` : headers additionnels (ex: Authorization Bearer).
 * - `allowHtml` : si `true`, accepte `Content-Type: text/html` et utilise un
 *   header `Accept` orienté HTML (utile pour `extractor.ts` qui doit parser
 *   des pages d'articles). Défaut : `false` (préserve le comportement strict
 *   de la story 2-1 qui rejette les pages HTML servies à la place d'un flux).
 * - `signal` : AbortSignal externe. Si fourni, est concaténé avec le timeout
 *   interne : tout abort externe annule la requête en vol.
 */
export async function fetchWithRateLimit(
  url: string,
  options: { headers?: Record<string, string>; allowHtml?: boolean; signal?: AbortSignal } = {},
): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL avec protocole non supporté : ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Hôte bloqué (SSRF guard) : ${parsed.hostname}`);
  }
  await waitForRateLimit(parsed.hostname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Si le caller fournit un signal externe, on l'écoute pour abort le
  // controller interne (qui cascadera vers fetch()).
  const externalSignal = options.signal;
  let externalAbortListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error(`Annulation externe détectée avant fetch de ${url}`);
    }
    externalAbortListener = () => controller.abort();
    externalSignal.addEventListener("abort", externalAbortListener, { once: true });
  }

  try {
    // `redirect: "manual"` empêche le bypass SSRF : on N'INTERPRETE PAS les 3xx
    // automatiquement. Le caller peut revalider response.url (qui pointe vers
    // la 3xx brute) si besoin, mais on évite que fetch() suive silencieusement
    // vers un hôte privé (ex: 169.254.169.254).
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.allowHtml ? HTML_ACCEPT_HEADER : ACCEPT_HEADER,
        ...options.headers,
      },
      signal: controller.signal,
      redirect: "manual",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (!options.allowHtml) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("text/html")) {
        throw new Error(`Content-Type text/html non supporté (attendu RSS/XML/JSON)`);
      }
    }
    return response;
  } finally {
    clearTimeout(timeoutId);
    if (externalAbortListener && externalSignal) {
      externalSignal.removeEventListener("abort", externalAbortListener);
    }
  }
}

/**
 * Lit le body d'une Response en string, borné à 5 MB.
 * Helper exporté pour les parsers.
 */
export async function readTextBounded(response: Response): Promise<string> {
  return readBoundedBody(response);
}

/**
 * Réinitialise la map de rate limit (utile pour les tests).
 * NE PAS exposer hors du worker.
 */
export function __resetRateLimitForTests(): void {
  lastRequestPerHost.clear();
}

/** Réexport UUID pour le scanner (lock Firestore + scanId). */
export function newScanId(): string {
  return randomUUID();
}
