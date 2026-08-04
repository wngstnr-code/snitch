/**
 * Skema DB (PLAN.md §0.5). Sengaja diselaraskan field-per-field dengan
 * `lib/types.ts` — kalau bentuk DB dan bentuk API menyimpang, integrasi pecah.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  AgentAssessment,
  Evidence,
  EvidenceKind,
  HumanReview,
  Plot,
  VerificationStatus,
  Verdict,
} from '../types';

// ---------- plots ----------

export const plots = pgTable(
  'plots',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** GeoJSON.Polygon | GeoJSON.MultiPolygon */
    geojson: jsonb('geojson').$type<Plot['geojson']>().notNull(),
    geohash: text('geohash').notNull(),
    areaHa: doublePrecision('area_ha').notNull(),
    operatorName: text('operator_name').notNull(),
    source: text('source').$type<Plot['source']>().notNull(),

    /** Metadata dataset pabrik (§3.4 / §3.4c) — null untuk plot hasil upload. */
    millUmlId: text('mill_uml_id'),
    millRspoStatusUml: text('mill_rspo_status_uml'),
    millRspoCertifiedUnilever: boolean('mill_rspo_certified_unilever'),
    millRspoType: text('mill_rspo_type'),
    millParentCompany: text('mill_parent_company'),
    millCountry: text('mill_country'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    /** radius sourcing (m) untuk pabrik bergeometri POINT (R12) */
    sourcingRadiusM: integer('sourcing_radius_m'),
    datasetSourceUrl: text('dataset_source_url'),
    datasetFetchedAt: timestamp('dataset_fetched_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('plots_source_idx').on(t.source),
    index('plots_geohash_idx').on(t.geohash),
    index('plots_mill_uml_id_idx').on(t.millUmlId),
  ],
);

// ---------- verifications ----------

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    plotId: text('plot_id')
      .notNull()
      .references(() => plots.id),
    status: text('status').$type<VerificationStatus>().notNull(),

    /** R4: parameter, BUKAN now(). Menentukan jendela bukti attestation. */
    evidenceAsOf: timestamp('evidence_as_of', { withTimezone: true }).notNull(),

    /**
     * Operator EU yang diverifikasi ke GLEIF (§3.2). Disimpan supaya
     * "Re-verify now" (R6) bisa mengulang verifikasi yang sama persis —
     * tanpa ini, pemeriksaan ulang diam-diam kehilangan sisi badan hukumnya
     * dan hasilnya terlihat lebih bersih daripada yang pertama.
     */
    euOperatorName: text('eu_operator_name'),
    euOperatorJurisdiction: text('eu_operator_jurisdiction'),

    bundleId: text('bundle_id'),
    bundleHash: text('bundle_hash'),
    bundleBlobUrl: text('bundle_blob_url'),

    assessment: jsonb('assessment').$type<AgentAssessment>(),
    review: jsonb('review').$type<HumanReview>(),

    /** Error jujur yang ikut tampil di UI (R10). */
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('verifications_status_idx').on(t.status),
    index('verifications_plot_idx').on(t.plotId),
  ],
);

// ---------- evidence_items ----------

export const evidenceItems = pgTable(
  'evidence_items',
  {
    /**
     * `Evidence.id` — inilah yang disitir agen dan divalidasi keras (R5).
     *
     * BUKAN primary key sendirian. Id bukti bersifat deterministik dari isinya
     * (mis. hash tile + geometri), jadi dua verifikasi atas petak yang sama
     * dengan batas bukti yang sama menghasilkan id yang identik — dan itu
     * memang benar, bukti yang sama ya bukti yang sama. Dengan id sebagai PK
     * tunggal, penyimpanan verifikasi kedua ditolak senyap dan bundle-nya
     * tampil kehilangan sebagian besar buktinya. Kuncinya majemuk bersama
     * `verification_id`; keunikan yang dituntut R5 adalah keunikan DI DALAM
     * satu bundle, dan itu tetap terjaga.
     */
    id: text('id').notNull(),
    verificationId: text('verification_id')
      .notNull()
      .references(() => verifications.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<EvidenceKind>().notNull(),
    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    rawHash: text('raw_hash').notNull(),

    /**
     * Payload lengkap sesuai varian di lib/types.ts. Sengaja memakai union
     * `Evidence` itu sendiri, bukan daftar varian yang disalin: menyalinnya
     * berarti tiap penambahan jenis bukti baru gagal senyap di lapisan DB.
     */
    payload: jsonb('payload').$type<Evidence>().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.verificationId, t.id] }),
    index('evidence_items_verification_idx').on(t.verificationId),
    index('evidence_items_kind_idx').on(t.kind),
  ],
);

export type EvidenceRow = typeof evidenceItems.$inferSelect & {
  payload: Evidence;
};

// ---------- attestations ----------

export const attestations = pgTable(
  'attestations',
  {
    uid: text('uid').primaryKey(),
    verificationId: text('verification_id')
      .notNull()
      .references(() => verifications.id),
    chainId: integer('chain_id').notNull(),
    schemaUid: text('schema_uid').notNull(),
    txHash: text('tx_hash').notNull(),
    attester: text('attester').notNull(),

    verdict: text('verdict').$type<Verdict>().notNull(),
    confidence: integer('confidence').notNull(),
    evidenceHash: text('evidence_hash').notNull(),
    evidenceUri: text('evidence_uri').notNull(),
    /** Nilai yang benar-benar di-encode onchain (R4). */
    evidenceAsOf: timestamp('evidence_as_of', { withTimezone: true }).notNull(),

    attestedAt: timestamp('attested_at', { withTimezone: true }).notNull(),
    revoked: boolean('revoked').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeTxHash: text('revoke_tx_hash'),
    revokeReason: text('revoke_reason'),

    /** Waktu watcher terakhir memeriksa attestation ini (B9). */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  },
  (t) => [
    index('attestations_verification_idx').on(t.verificationId),
    /**
     * Satu verifikasi = paling banyak satu attestation AKTIF.
     *
     * Endpoint attest sudah menolak verifikasi yang punya attestation, tapi
     * pemeriksaan itu terjadi sebelum transaksi onchain yang makan puluhan
     * detik — dua permintaan bersamaan sama-sama lolos dan menerbitkan dua
     * attestation untuk bukti yang sama. Batasan di DB membuat balapan itu
     * mustahil, bukan sekadar tidak mungkin secara kebetulan.
     *
     * Parsial, hanya atas baris yang belum dicabut: attestation yang sudah
     * ter-revoke adalah peristiwa onchain yang benar-benar terjadi, dan
     * riwayatnya tidak boleh dipaksa hilang demi memenuhi sebuah batasan.
     */
    uniqueIndex('attestations_active_verification_uq')
      .on(t.verificationId)
      .where(sql`${t.revoked} = false`),
    index('attestations_revoked_idx').on(t.revoked),
  ],
);

// ---------- sanctions_entries ----------

export const sanctionsEntries = pgTable(
  'sanctions_entries',
  {
    id: text('id').primaryKey(),
    list: text('list').$type<'OFAC_SDN' | 'EU_CONSOLIDATED'>().notNull(),
    /** ID entri di daftar aslinya. */
    entryId: text('entry_id').notNull(),
    name: text('name').notNull(),
    /** Nama ternormalisasi untuk pencocokan. */
    nameNormalized: text('name_normalized').notNull(),
    entityType: text('entity_type'),
    programs: text('programs'),
    country: text('country'),

    /** Tanggal publikasi daftar + kapan kita mengunduhnya (§9). */
    listDate: timestamp('list_date', { withTimezone: true }).notNull(),
    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    rawHash: text('raw_hash').notNull(),
  },
  (t) => [
    uniqueIndex('sanctions_list_entry_uq').on(t.list, t.entryId),
    index('sanctions_name_norm_idx').on(t.nameNormalized),
  ],
);

// ---------- review_log ----------

export const reviewLog = pgTable(
  'review_log',
  {
    id: text('id').primaryKey(),
    verificationId: text('verification_id')
      .notNull()
      .references(() => verifications.id, { onDelete: 'cascade' }),
    decision: text('decision')
      .$type<HumanReview['decision']>()
      .notNull(),
    overrideVerdict: text('override_verdict').$type<Verdict>(),
    reason: text('reason').notNull(),
    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('review_log_verification_idx').on(t.verificationId)],
);

// ---------- watcher runs ----------

export const watchRuns = pgTable('watch_runs', {
  id: text('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  checked: integer('checked').notNull().default(0),
  revokedCount: integer('revoked_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  /** 'cron' | 'manual' — /recheck memakai runner yang sama (R6). */
  trigger: text('trigger').$type<'cron' | 'manual'>().notNull(),
  durationS: real('duration_s'),
});

export type PlotRow = typeof plots.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type AttestationRow = typeof attestations.$inferSelect;
export type SanctionsEntryRow = typeof sanctionsEntries.$inferSelect;
export type ReviewLogRow = typeof reviewLog.$inferSelect;
export type WatchRunRow = typeof watchRuns.$inferSelect;
