/**
 * Geohash — dipakai untuk `Plot.geohash` dan field `plotGeohash` di attestation.
 *
 * Kenapa ada di sini dan bukan di lib/evidence: nilainya ikut di-encode onchain,
 * jadi ia bagian dari kontrak attestation, bukan bagian dari pengumpulan bukti.
 *
 * Implementasi base32 standar Niemeyer. Tanpa dependensi — satu-satunya cara
 * memastikan nilai yang di-anchor onchain bisa direproduksi verifikator lain.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Presisi 9 ≈ 4,8 m — cukup untuk menandai identitas petak, bukan batasnya. */
export const GEOHASH_PRECISION = 9;

export function encodeGeohash(
  lat: number,
  lon: number,
  precision: number = GEOHASH_PRECISION,
): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`lat di luar rentang: ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`lon di luar rentang: ${lon}`);
  }

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = '';
  let bits = 0;
  let bit = 0;
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bit = (bit << 1) + 1;
        lonMin = mid;
      } else {
        bit = bit << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;

    bits += 1;
    if (bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }

  return hash;
}

/**
 * Geohash sebuah geometri = geohash titik tengah bounding box-nya.
 *
 * Ini sengaja BUKAN centroid berbobot luas: yang dibutuhkan adalah label
 * lokasi yang stabil dan bisa dihitung ulang siapa pun dari GeoJSON yang sama,
 * bukan pusat massa yang benar secara geometris.
 */
export function geohashOfBBox(
  b: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  precision: number = GEOHASH_PRECISION,
): string {
  return encodeGeohash(
    (b.minLat + b.maxLat) / 2,
    (b.minLon + b.maxLon) / 2,
    precision,
  );
}
