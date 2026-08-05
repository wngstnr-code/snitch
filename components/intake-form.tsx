'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreateVerificationRequest, Plot } from '@/lib/types';
import { createVerification, fetchMills } from '@/lib/ui/api';
import { PlotMap } from '@/components/plot-map';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingLine } from '@/components/ui/states';
import { Pill } from '@/components/ui/badge';
import {
  areaHaOf,
  formatArea,
  formatNumber,
  radiusKmFromArea,
} from '@/lib/ui/format';

/**
 * Intake petak.
 *
 * Dua jalur, dan perbedaannya dinyatakan terbuka di UI karena secara
 * metodologis memang berbeda:
 *
 *  - **Pabrik** bergeometri titik, jadi yang dianalisis adalah radius sourcing
 *    50 km di sekelilingnya. Hasilnya *risiko sourcing pabrik*, BUKAN
 *    verifikasi tingkat petak. Menyebutnya verifikasi petak akan menyesatkan.
 *  - **Unggahan GeoJSON** adalah polygon petak sungguhan → verifikasi petak.
 *
 * `evidenceAsOf` sengaja bisa diatur. Itu bukan celah, itu memang parameter:
 * attestation menjamin sebuah rentang waktu, dan rentang itu harus bisa
 * dinyatakan. Menerbitkan dengan jendela bukti masa lalu lalu menjalankan
 * watcher adalah cara membuktikan mekanisme pencabutan dengan data asli.
 */

type Mode = 'mill' | 'upload';

interface UploadState {
  name: string;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  vertices: number;
  /** Dihitung di sini agar luasnya terlihat SEBELUM dikirim (PLAN.md A2). */
  areaHa: number;
}

export function IntakeForm() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('mill');

  const [mills, setMills] = useState<Plot[] | null>(null);
  const [millsError, setMillsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Plot | null>(null);

  const [upload, setUpload] = useState<UploadState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [operatorName, setOperatorName] = useState('');
  /**
   * Menandai bahwa kolom operator diisi manusia, bukan hasil pilih pabrik.
   * Tanpa ini, versi sebelumnya hanya mengisi kolom saat masih kosong — jadi
   * memilih pabrik KEDUA meninggalkan nama pabrik PERTAMA di sana. Nama itulah
   * yang disaring ke OFAC dan daftar sanksi Uni Eropa, sehingga berkas bukti
   * akan berisi hasil screening perusahaan yang sama sekali berbeda dari petak
   * yang diverifikasi.
   */
  const [operatorTouched, setOperatorTouched] = useState(false);
  const [plotName, setPlotName] = useState('');
  const [evidenceAsOf, setEvidenceAsOf] = useState('');
  const [euLegalName, setEuLegalName] = useState('');
  const [euJurisdiction, setEuJurisdiction] = useState('');

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startedAt = useRef(0);

  // ── muat pabrik ──
  const loadMills = useCallback(async () => {
    try {
      const data = await fetchMills({ limit: 5000 });
      setMills(data);
      setMillsError(null);
      return data;
    } catch (e) {
      setMills([]);
      setMillsError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function read() {
      const data = await loadMills();
      if (!alive || !data) return;
    }
    void read();
    return () => {
      alive = false;
    };
  }, [loadMills]);

  // ── penghitung waktu berjalan, angka sungguhan ──
  // `startedAt` distempel di handler kirim, bukan di sini, supaya effect ini
  // tidak menulis state secara sinkron saat dipasang.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy]);

  function readFile(file: File) {
    setUploadError(null);
    setUpload(null);
    const reader = new FileReader();
    reader.onerror = () => setUploadError('The file could not be read.');
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const geom = extractPolygon(parsed);
        setUpload({
          name: file.name,
          geojson: geom,
          vertices: countVertices(geom),
          areaHa: areaHaOf(geom),
        });
        if (!plotName) setPlotName(file.name.replace(/\.(geo)?json$/i, ''));
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  }

  /** Ketikan manusia yang menyimpang dari pabrik terpilih — perlu diperingatkan. */
  const mismatch =
    mode === 'mill' &&
    !!selected &&
    operatorName.trim().length > 0 &&
    operatorName.trim() !== selected.operatorName.trim();

  const ready =
    operatorName.trim().length > 0 &&
    (mode === 'mill' ? !!selected : !!upload && plotName.trim().length > 0) &&
    (euLegalName.trim().length === 0 || /^[A-Za-z]{2}$/.test(euJurisdiction.trim()));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    startedAt.current = Date.now();
    setElapsed(0);
    setBusy(true);
    try {
      const body: CreateVerificationRequest = {
        plot:
          mode === 'mill'
            ? {
                id: selected!.id,
                name: selected!.name,
                geojson: selected!.geojson,
                operatorName: selected!.operatorName,
                source: 'mill_dataset',
              }
            : {
                name: plotName.trim(),
                geojson: upload!.geojson,
                operatorName: operatorName.trim(),
                source: 'upload',
              },
        operatorName: operatorName.trim(),
        ...(evidenceAsOf
          ? { evidenceAsOf: new Date(`${evidenceAsOf}T00:00:00Z`).toISOString() }
          : {}),
        ...(euLegalName.trim()
          ? {
              euOperator: {
                legalName: euLegalName.trim(),
                jurisdiction: euJurisdiction.trim().toUpperCase(),
              },
            }
          : {}),
      };

      const v = await createVerification(body);
      router.push(`/verifications/${v.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      {/* ── peta ── */}
      <div className="space-y-3">
        <PlotMap
          plots={mode === 'mill' ? (mills ?? []) : []}
          selectedPlotId={selected?.id ?? null}
          onSelect={(p) => {
            setSelected(p);
            if (!operatorTouched) setOperatorName(p.operatorName);
          }}
          focus={mode === 'mill' ? selected : uploadAsPlot(upload)}
          className="h-[380px] lg:h-[560px]"
        />
        {mode === 'mill' ? (
          mills === null ? (
            <LoadingLine label="loading mill dataset…" />
          ) : millsError ? (
            <ErrorState
              title="The mill dataset could not be loaded"
              message={millsError}
              action={
                <Button variant="outline" size="sm" onClick={() => void loadMills()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <p className="eyebrow">
              {formatNumber(mills.length)} mills on the map · click one to select
            </p>
          )
        ) : (
          <p className="eyebrow">
            Uploaded polygon is drawn on the map once the file is read
          </p>
        )}
      </div>

      {/* ── formulir ── */}
      <div className="space-y-5">
        <div className="sheet overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-rule">
            {(
              [
                ['mill', 'Pick a mill'],
                ['upload', 'Upload GeoJSON'],
              ] as Array<[Mode, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`px-3 py-2.5 text-sm font-medium transition-colors ${
                  mode === value
                    ? 'bg-foreground text-background'
                    : 'bg-card hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="px-4 py-4">
            {mode === 'mill' ? (
              selected ? (
                <div>
                  <p className="eyebrow">Selected</p>
                  <p className="mt-1 font-medium">{selected.name}</p>
                  <p className="datum mt-0.5 text-muted-foreground">
                    {selected.operatorName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Pill tone="neutral">{formatArea(selected.areaHa)}</Pill>
                    <Pill tone="hold">
                      {radiusKmFromArea(selected.areaHa)} km sourcing radius
                    </Pill>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    A mill is a point, not a plot. What gets analysed is the
                    sourcing radius around it — standard palm oil industry
                    methodology. The result is{' '}
                    <strong className="text-foreground">mill sourcing risk</strong>,
                    not plot-level verification.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click any point on the map to pick a mill.
                </p>
              )
            ) : (
              <div>
                <label className="eyebrow mb-1.5 block" htmlFor="file">
                  Plot GeoJSON file
                </label>
                <input
                  id="file"
                  type="file"
                  accept=".json,.geojson,application/geo+json,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f);
                  }}
                  className="datum w-full rounded-sm border border-rule bg-card px-2.5 py-2 file:mr-3 file:rounded-sm file:border-0 file:bg-foreground file:px-2.5 file:py-1 file:text-background"
                />
                {upload ? (
                  <div className="mt-3">
                    <p className="datum">{upload.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <Pill tone="chain">{upload.geojson.type}</Pill>
                      <Pill tone="neutral">{formatArea(upload.areaHa)}</Pill>
                      <Pill tone="neutral">
                        {formatNumber(upload.vertices)} vertices
                      </Pill>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Area is computed from the geometry itself, never read from
                      a field in the file. The server recomputes it with the same
                      formula before collecting any evidence.
                    </p>
                  </div>
                ) : null}
                {uploadError ? (
                  <ErrorState
                    className="mt-3"
                    title="GeoJSON rejected"
                    message={uploadError}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="sheet space-y-4 px-4 py-4">
          {mode === 'upload' ? (
            <Field label="Plot name" htmlFor="plotName">
              <input
                id="plotName"
                value={plotName}
                onChange={(e) => setPlotName(e.target.value)}
                placeholder="e.g. Block C — Sungai Tekam Estate"
                className={INPUT}
              />
            </Field>
          ) : null}

          <Field label="Exporter / operator name" htmlFor="operatorName">
            <input
              id="operatorName"
              value={operatorName}
              onChange={(e) => {
                setOperatorTouched(true);
                setOperatorName(e.target.value);
              }}
              placeholder="e.g. Sime Darby Plantation Berhad"
              className={INPUT}
            />
            <Hint>This name is screened against the OFAC and EU sanctions lists.</Hint>
            {mismatch ? (
              <p className="mt-1.5 rounded-sm border border-hold/40 bg-hold-soft px-2.5 py-2 text-xs leading-relaxed">
                This does not match the operator on record for{' '}
                <strong>{selected!.name}</strong>, which is{' '}
                <strong>{selected!.operatorName}</strong>. Sanctions screening
                will run against the name typed here, so the evidence would
                describe a different company than the plot.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setOperatorName(selected!.operatorName);
                    setOperatorTouched(false);
                  }}
                  className="text-chain underline underline-offset-2"
                >
                  Use the mill operator
                </button>
              </p>
            ) : null}
          </Field>

          <Field label="Evidence window (optional)" htmlFor="evidenceAsOf">
            <input
              id="evidenceAsOf"
              type="date"
              value={evidenceAsOf}
              onChange={(e) => setEvidenceAsOf(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className={INPUT}
            />
            <Hint>
              The date through which this attestation vouches. Leave it empty to
              use today. Setting it to a past date is how you exercise the
              revocation mechanism, using satellite alerts that genuinely
              occurred after that date.
            </Hint>
          </Field>

          <fieldset className="border-t border-rule pt-4">
            <legend className="eyebrow">EU operator (optional)</legend>
            <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
              The party legally required to file the Due Diligence Statement,
              verified against GLEIF. Leaving it empty means no legal-entity
              evidence is created at all — and its absence means{' '}
              <strong className="text-foreground">not verified</strong>, not
              cleared.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={euLegalName}
                onChange={(e) => setEuLegalName(e.target.value)}
                placeholder="EU importer legal name"
                className={INPUT}
                aria-label="EU operator legal name"
              />
              <input
                value={euJurisdiction}
                onChange={(e) => setEuJurisdiction(e.target.value.toUpperCase())}
                placeholder="NL"
                maxLength={2}
                className={`${INPUT} sm:w-20 uppercase`}
                aria-label="Two-letter ISO country code"
              />
            </div>
            {euLegalName.trim() && !/^[A-Za-z]{2}$/.test(euJurisdiction.trim()) ? (
              <p className="mt-1.5 text-xs text-alert">
                A two-letter country code is required — name matching without a
                jurisdiction produces false matches across countries.
              </p>
            ) : null}
          </fieldset>
        </div>

        {submitError ? (
          <ErrorState title="Verification could not run" message={submitError} />
        ) : null}

        {busy ? (
          <div className="sheet border-chain/40 bg-chain-soft px-4 py-4">
            <LoadingLine label={`running · ${elapsed}s`} />
            <p className="mt-2 text-sm leading-relaxed">
              The server is downloading satellite tiles, decoding their pixels,
              screening sanctions lists, and running the agent. This is real work
              and usually takes tens of seconds. Do not close this page.
            </p>
          </div>
        ) : null}

        <Button type="submit" size="lg" disabled={!ready || busy}>
          {busy ? 'Collecting evidence…' : 'Run verification'}
        </Button>
      </div>
    </form>
  );
}

const INPUT =
  'w-full rounded-sm border border-rule bg-card px-2.5 py-2 font-[family-name:var(--font-data)] text-[0.8125rem]';

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="eyebrow mb-1.5 block" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
  );
}

// ---------- GeoJSON ----------

/**
 * Menarik satu polygon dari bentuk GeoJSON apa pun yang lumrah diekspor
 * perangkat GIS. Menolak dengan pesan yang menyebut apa yang salah — pengguna
 * tidak boleh menebak kenapa berkasnya ditolak.
 */
function extractPolygon(
  input: unknown,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (typeof input !== 'object' || input === null) {
    throw new Error('The file contents are not a JSON object.');
  }
  const obj = input as { type?: unknown };

  if (obj.type === 'FeatureCollection') {
    const fc = input as GeoJSON.FeatureCollection;
    const feature = fc.features?.find(
      (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
    );
    if (!feature) {
      throw new Error(
        'This FeatureCollection contains no Polygon or MultiPolygon.',
      );
    }
    return validate(feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
  }

  if (obj.type === 'Feature') {
    const f = input as GeoJSON.Feature;
    if (f.geometry?.type !== 'Polygon' && f.geometry?.type !== 'MultiPolygon') {
      throw new Error(
        `The Feature geometry is ${f.geometry?.type ?? 'empty'}; a Polygon or MultiPolygon is required.`,
      );
    }
    return validate(f.geometry);
  }

  if (obj.type === 'Polygon' || obj.type === 'MultiPolygon') {
    return validate(input as GeoJSON.Polygon | GeoJSON.MultiPolygon);
  }

  throw new Error(
    `GeoJSON type "${String(obj.type)}" is not supported. Send a Polygon, MultiPolygon, Feature, or FeatureCollection.`,
  );
}

function validate(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (countVertices(geom) < 4) {
    throw new Error('The polygon has fewer than four vertices — it does not close.');
  }
  return geom;
}

function countVertices(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  return rings.reduce((n, ring) => n + ring.length, 0);
}

/** Membungkus unggahan jadi `Plot` seadanya supaya peta bisa memusat ke sana. */
function uploadAsPlot(u: UploadState | null): Plot | null {
  if (!u) return null;
  return {
    id: 'upload-preview',
    name: u.name,
    geojson: u.geojson,
    geohash: '',
    areaHa: u.areaHa,
    operatorName: '',
    source: 'upload',
  };
}
