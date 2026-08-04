/**
 * Isi tabel `plots` dari dataset pabrik sawit nyata + cross-check RSPO.
 *
 *   npm run mills:seed              # default: Malaysia saja
 *   npm run mills:seed -- --all     # semua negara
 *
 * Idempoten: `plots.id` diturunkan deterministik dari `UML_ID`
 * (`mill:PO1000000019`), jadi `onConflictDoUpdate` membuat menjalankan script
 * ini dua kali aman — baris diperbarui di tempat, bukan digandakan.
 *
 * Kenapa dibatasi Malaysia secara default (CLAUDE.md §3.4c aturan #7):
 * target produk ini eksportir sawit Malaysia, dan ~500 baris cukup untuk demo
 * tanpa membebani DB dev/Neon dengan ribuan baris tak terpakai.
 */

import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { plots } from '../lib/db/schema';
import { areaHa } from '../lib/evidence/gfw';
import { encodeGeohash } from '../lib/geohash';
import {
  fetchUniversalMillList,
  fetchUnileverMills,
  joinMills,
  sourcingCircle,
  SOURCING_RADIUS_M,
  type MillJoin,
} from '../lib/evidence/mills';

function parseArgs(argv: string[]): { country: 'MY' | 'ALL' } {
  const all = argv.includes('--all');
  const countryArg = argv.find((a) => a.startsWith('--country='));
  if (all) return { country: 'ALL' };
  if (countryArg) {
    const v = countryArg.split('=')[1]?.toUpperCase();
    if (v === 'ALL') return { country: 'ALL' };
    if (v === 'MY') return { country: 'MY' };
    throw new Error(`--country=${v} tidak dikenal. Pakai MY atau ALL.`);
  }
  return { country: 'MY' }; // default
}

async function main() {
  const { country } = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  console.log('Mengunduh Universal Mill List...');
  const uml = await fetchUniversalMillList();
  console.log(`  ${uml.mills.length.toLocaleString('id-ID')} pabrik · ${uml.sourceUrl}`);

  console.log('Mengunduh Unilever Palm Oil Mills...');
  const unilever = await fetchUnileverMills();
  console.log(`  ${unilever.mills.length.toLocaleString('id-ID')} pabrik · ${unilever.sourceUrl}`);

  const umlFiltered =
    country === 'MY' ? uml.mills.filter((m) => m.country === 'Malaysia') : uml.mills;
  console.log(
    `Filter negara: ${country} → ${umlFiltered.length.toLocaleString('id-ID')} pabrik UML dipakai.`,
  );

  const joins = joinMills(umlFiltered, unilever.mills);
  const matched = joins.filter((j) => j.matchedBy === 'name+proximity');
  const disagreements = joins.filter((j) => j.rspoDisagreement);

  console.log(`Ter-join ke Unilever: ${matched.length.toLocaleString('id-ID')} / ${joins.length}`);
  console.log(`Ketidaksepakatan RSPO (rspoDisagreement): ${disagreements.length.toLocaleString('id-ID')}`);
  if (disagreements.length > 0) {
    console.log('Contoh ketidaksepakatan (amunisi demo):');
    for (const d of disagreements.slice(0, 5)) {
      console.log(
        `  - ${d.uml.name} (UML=${d.uml.rspoStatus}, ` +
          `Unilever=${d.unilever?.rspoCertified === true ? 'Yes' : 'No'}, ` +
          `parent=${d.uml.parentCompany ?? d.unilever?.parentCompany ?? '?'})`,
      );
    }
  }

  const fetchedAt = new Date();
  const rows = joins.map((j: MillJoin) => {
    const geom = sourcingCircle(j.uml.lat, j.uml.lon, SOURCING_RADIUS_M);
    return {
      id: `mill:${j.uml.umlId}`,
      name: j.uml.name,
      geojson: geom,
      // Geohash titik pabrik itu sendiri, BUKAN pusat lingkaran sourcing —
      // nilainya identik (titik pabrik = pusat lingkaran) tapi niatnya beda:
      // ini label identitas lokasi pabrik, bukan properti geometri turunan.
      geohash: encodeGeohash(j.uml.lat, j.uml.lon),
      areaHa: areaHa(geom),
      operatorName: j.uml.parentCompany ?? j.unilever?.parentCompany ?? j.uml.name,
      source: 'mill_dataset' as const,
      millUmlId: j.uml.umlId,
      millRspoStatusUml: j.uml.rspoStatus,
      millRspoCertifiedUnilever: j.unilever?.rspoCertified ?? null,
      millRspoType: j.uml.rspoType,
      millParentCompany: j.uml.parentCompany ?? j.unilever?.parentCompany ?? null,
      millCountry: j.uml.country,
      lat: j.uml.lat,
      lon: j.uml.lon,
      sourcingRadiusM: SOURCING_RADIUS_M,
      datasetSourceUrl: `${uml.sourceUrl} + ${unilever.sourceUrl}`,
      datasetFetchedAt: fetchedAt,
    };
  });

  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db
      .insert(plots)
      .values(batch)
      .onConflictDoUpdate({
        target: plots.id,
        set: {
          name: sql`excluded.name`,
          geojson: sql`excluded.geojson`,
          geohash: sql`excluded.geohash`,
          areaHa: sql`excluded.area_ha`,
          operatorName: sql`excluded.operator_name`,
          source: sql`excluded.source`,
          millUmlId: sql`excluded.mill_uml_id`,
          millRspoStatusUml: sql`excluded.mill_rspo_status_uml`,
          millRspoCertifiedUnilever: sql`excluded.mill_rspo_certified_unilever`,
          millRspoType: sql`excluded.mill_rspo_type`,
          millParentCompany: sql`excluded.mill_parent_company`,
          millCountry: sql`excluded.mill_country`,
          lat: sql`excluded.lat`,
          lon: sql`excluded.lon`,
          sourcingRadiusM: sql`excluded.sourcing_radius_m`,
          datasetSourceUrl: sql`excluded.dataset_source_url`,
          datasetFetchedAt: sql`excluded.dataset_fetched_at`,
        },
      });
    written += batch.length;
  }

  console.log(
    `✔ ${written.toLocaleString('id-ID')} baris ditulis/diperbarui di \`plots\` · ` +
      `${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

main().catch((err: unknown) => {
  console.error('GAGAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
