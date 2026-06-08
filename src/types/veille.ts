import type { Timestamp } from "firebase/firestore";

/**
 * Types du système de veille automatique SIRH/IA.
 * Cf. spec _bmad-output/specs/spec-veille-automatique/SPEC.md (CAP-1)
 */

export type SourceType = "rss" | "sitemap" | "api";

export type ScanFrequency = "daily" | "weekly" | "custom";

export interface VeilleSource {
  id: string;
  name: string;
  url: string;
  type: SourceType;
  apiKeyEnvVar?: string;
  keywords: string[];
  categories: string[];
  active: boolean;
  lastScanAt: Timestamp | null;
  scanFrequency: ScanFrequency;
  cronExpression?: string;
  /**
   * Score de fiabilité de la source, sur une échelle 0-100.
   * Validé côté Firestore rules (`isValidVeilleSource`, voir firestore.rules).
   * Élevée = 85, Moyenne = 70 (cf. `DEFAULT_RELIABILITY_*`).
   */
  reliabilityScore: number;
}

export const DEFAULT_RELIABILITY_HIGH = 85;
export const DEFAULT_RELIABILITY_MEDIUM = 70;
