# PRISME — Travail différé

## Deferred from: code review of story 2-1 (2026-06-03)

- **CRON: sémantique dom/dow OU (Vixie cron)** [scanner.ts:54-66] — parser custom, hors spec story 2-1. Raison : parser CRON 5-champs documenté comme best-effort. V2: adopter `cron-parser` ou `node-cron` parser pour respecter sémantique standard.
- **`getAdminDb()` non thread-safe (deux `initializeApp`)** [firebaseAdmin.ts:52-56] — init lazy + flag `_initialized`, suffisant pour process unique. Raison : environnement mono-process. V2: mutex module-level si passage multi-replica.
- **Firestore query `in` casse > 30 sources** [scanner.ts:454-456] — limite Firestore `in` queries. Raison : admin PRISME vise 5-10 sources max. V2: split en 3 queries `==` si > 30.
- **`setDoc` `ScanResult` peut dépasser 1MB** [scanner.ts:300-307] — doc limit Firestore. Raison : admin max 30 sources. V2: subcollection `veille_scan_log/{scanId}/sources/{sourceId}`.
- **CRON timezone serveur (UTC prod)** [scanner.ts:54] — utilise TZ serveur. Raison : pas de champ `timezone` dans `VeilleSource`. V2: ajouter champ + utiliser `Intl.DateTimeFormat`.
- **`scanInProgress` TOCTOU sur await** [scanner.ts:34] — mutex in-memory OK. Raison : mono-process + lock Firestore distribué (patch D1) couvre cross-replica. Non-actionable.
- **`handleScanCronTick` swallow erreurs (no dead man's switch)** [scanner.ts:540-544] — fire-and-forget + console.error. Raison : pas de Sentry/métriques configuré. V2: écrire `lastSuccessfulScanAt` + alerte si > 48h.
- **`firestore.rules` pas de règle explicite `veille_scan_log`** [firestore.rules] — admin SDK bypass. Raison : admin bypass volontaire. V2: ajouter deny-all client pour `veille_scan_log`.
- **UA sans contact (ToS)** [fetch.ts:14] — `PRISME-Bot/1.0` strict. Raison : pas de domaine public configuré. V2: `PRISME-Bot/1.0 (+https://prisme.example.com/bot)`.
- **`cronExpression` année/match any-year** [scanner.ts:122-126] — `cronMatchesNow` ignore l'année. Raison : admin gated + expression 5-champs standard. V2: ajouter garde année si abuse.
- **`<content:encoded>` non extrait (titre tronqué)** [scanner.ts:184-201] — extraction = story 2-2. Raison : hors scope story 2-1 (CAP-2 worker de scan, pas enrichissement).

## Deferred from: code review of story 2-2 (2026-06-04)

- **Pas de retry sur `fetchWithRateLimit`** [fetch.ts] — conforme stack.md (retry = amplification rate limit, hors spec). Raison : pattern établi story 2-1, story 2-2 hérite sans modifier. V2: retry exponentiel + jitter sur 5xx uniquement.
