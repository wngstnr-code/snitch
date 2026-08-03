/**
 * Normalisasi & pencocokan nama badan hukum. Dipakai bersama oleh konektor
 * GLEIF (B2) dan sanksi (B3) supaya keduanya menormalkan dengan cara yang sama —
 * kalau berbeda, skor kemiripan antar modul jadi tidak sebanding.
 */

/** Bentuk hukum yang dibuang saat normalisasi — bukan bagian identitas nama. */
const LEGAL_FORM_TOKENS = new Set([
  'PLC', 'LTD', 'LIMITED', 'LLC', 'LP', 'LLP', 'INC', 'CORP', 'CORPORATION',
  'NV', 'BV', 'CV', 'SE', 'SA', 'SAS', 'SARL', 'SPA', 'SRL', 'AG', 'GMBH', 'KG',
  'AB', 'AS', 'ASA', 'OY', 'OYJ', 'APS', 'PTE', 'PTY', 'BHD', 'BERHAD', 'SDN',
  'TBK', 'PT', 'CO', 'COMPANY', 'OOO', 'OAO', 'PAO', 'ZAO', 'JSC', 'OJSC',
]);

export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    // Titik dihapus, BUKAN diubah jadi spasi: "N.V." harus menjadi satu token
    // "NV" agar dikenali sebagai bentuk hukum, bukan dua token "N" dan "V".
    .replace(/\./g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0 && !LEGAL_FORM_TOKENS.has(t))
    .join(' ');
}

export function nameTokens(name: string): string[] {
  return normalizeName(name).split(' ').filter(Boolean);
}

/** Dice coefficient atas token. 1 = identik, 0 = tidak beririsan sama sekali. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
