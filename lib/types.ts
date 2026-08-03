/**
 * SNITCH — kontrak tipe bersama (PLAN.md §0.3).
 *
 * 🔒 FILE BERSAMA. Perubahan wajib disepakati Dev A + Dev B secara eksplisit
 * (CLAUDE.md §6). Mengubah sepihak memutus kerja orang lain.
 *
 * Membutuhkan `@types/geojson` untuk namespace `GeoJSON`.
 */

// ---------- Evidence ----------

export type EvidenceKind = 'deforestation' | 'legal_entity' | 'sanctions';

export interface EvidenceBase {
  /** stabil, disitir oleh agen */
  id: string;
  kind: EvidenceKind;
  sourceUrl: string;
  /** ISO */
  fetchedAt: string;
  /** sha256 respons mentah */
  rawHash: string;
}

/** channel alpha 4 = low, 8 = high, 24 = highest (CLAUDE.md §3.1, R3) */
export type AlertConfidence = 'low' | 'high' | 'highest';

export interface DeforestationAlert {
  /** ISO, hasil dekode hari = R*255+G sejak 2014-12-31 */
  date: string;
  lat: number;
  lon: number;
  /** null HANYA bila alpha tak dikenal — jangan pernah ditebak */
  confidence: AlertConfidence | null;
  tile: { z: number; x: number; y: number };
}

export interface DeforestationEvidence extends EvidenceBase {
  kind: 'deforestation';
  /** penuh hanya bila <= 5.000 alert (R16) */
  alerts: DeforestationAlert[];
  /** selalu ada, deterministik */
  summary: {
    byMonth: Record<string, number>;
    byConfidence: Record<AlertConfidence, number>;
    truncated: boolean;
  };
  /** cutoff EUDR 2020-12-31 */
  alertsAfterCutoff: number;
  tilesScanned: number;
  zoom: number;
  /** mis. 'v20260803' — reproducibility (R14), jangan 'latest' */
  tileVersion: string;
  areaHa: number;
}

export interface LegalEntityEvidence extends EvidenceBase {
  kind: 'legal_entity';
  lei: string | null;
  legalName: string | null;
  /** ACTIVE / INACTIVE */
  entityStatus: string | null;
  registrationStatus: string | null;
  jurisdiction: string | null;
  matchQuality: 'exact' | 'fuzzy' | 'none';
}

export interface SanctionsEvidence extends EvidenceBase {
  kind: 'sanctions';
  lists: Array<{ list: 'OFAC_SDN' | 'EU_CONSOLIDATED'; listDate: string }>;
  matches: Array<{ name: string; list: string; score: number; entryId: string }>;
}

export type Evidence =
  | DeforestationEvidence
  | LegalEntityEvidence
  | SanctionsEvidence;

export interface EvidenceBundle {
  bundleId: string;
  /** ISO — BUKAN now(). Lihat R4. */
  evidenceAsOf: string;
  items: Evidence[];
  /** sha256, di-anchor onchain */
  bundleHash: string;
  blobUrl: string;
}

// ---------- Agent ----------

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface Finding {
  severity: 'critical' | 'major' | 'minor' | 'info';
  claim: string;
  contradiction: string;
  /** WAJIB ada di bundle — divalidasi kode, bukan dipercaya (R5) */
  evidenceIds: string[];
}

export interface AgentAssessment {
  verdict: Verdict;
  /** 0-100 */
  confidence: number;
  findings: Finding[];
  summary: string;
}

// ---------- Verification ----------

export type VerificationStatus =
  | 'pending'
  | 'collecting'
  | 'assessing'
  | 'awaiting_review'
  | 'attested'
  | 'revoked'
  | 'failed';

export interface Plot {
  id: string;
  name: string;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  geohash: string;
  areaHa: number;
  operatorName: string;
  source: 'upload' | 'mill_dataset';
}

export interface HumanReview {
  decision: 'approve' | 'reject' | 'override';
  overrideVerdict?: Verdict;
  reason: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface AttestationRef {
  uid: `0x${string}`;
  txHash: `0x${string}`;
  chainId: number;
  schemaUid: `0x${string}`;
  attestedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revokeTxHash: `0x${string}` | null;
  revokeReason: string | null;
  explorerUrl: string;
  easscanUrl: string;
}

export interface Verification {
  id: string;
  status: VerificationStatus;
  plot: Plot;
  bundle: EvidenceBundle | null;
  assessment: AgentAssessment | null;
  review: HumanReview | null;
  attestation: AttestationRef | null;
  /** error jujur, ditampilkan di UI — jangan pernah ditelan (R10) */
  error: string | null;
  createdAt: string;
}

// ---------- Kontrak request body endpoint (PLAN.md §0.3) ----------
//
//  GET  /api/mills?bbox=                      -> Plot[]
//  POST /api/verifications                    CreateVerificationRequest -> Verification
//  GET  /api/verifications                    -> Verification[]
//  GET  /api/verifications/[id]               -> Verification
//  POST /api/verifications/[id]/review        HumanReview -> Verification
//  POST /api/verifications/[id]/attest        -> Verification (dengan attestation)
//  POST /api/verifications/[id]/recheck       -> Verification (bisa memicu revoke)
//  GET  /api/v1/verify/[uid]                  -> PublicVerifyResponse
//  GET  /api/cron/watch                       -> WatchRunResult

export interface CreateVerificationRequest {
  plot: Omit<Plot, 'id' | 'geohash' | 'areaHa'> & {
    id?: string;
  };
  operatorName: string;
  /** ISO. Bila kosong, server memakai waktu sekarang. Lihat R4. */
  evidenceAsOf?: string;
}

export interface PublicVerifyResponse {
  uid: `0x${string}`;
  found: boolean;
  /** dibaca langsung dari chain, bukan dari DB */
  onchain: {
    revoked: boolean;
    revocationTime: string | null;
    time: string;
    attester: `0x${string}`;
    schemaUid: `0x${string}`;
    chainId: number;
    explorerUrl: string;
    easscanUrl: string;
  } | null;
  decoded: {
    plotId: string;
    plotGeohash: string;
    evidenceHash: `0x${string}`;
    evidenceUri: string;
    verdict: Verdict;
    confidence: number;
    evidenceAsOf: string;
    reviewedBy: string;
    legalEntityLEI: string;
  } | null;
  bundle: EvidenceBundle | null;
  error: string | null;
}

export interface WatchRunResult {
  checkedAt: string;
  checked: number;
  revoked: Array<{
    uid: `0x${string}`;
    revokeTxHash: `0x${string}`;
    reason: string;
    newAlertsAfterEvidenceAsOf: number;
  }>;
  errors: Array<{ uid: `0x${string}`; error: string }>;
}
