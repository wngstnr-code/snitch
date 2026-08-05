import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, Public_Sans } from 'next/font/google';
import './globals.css';

/**
 * Tiga wajah huruf, tiga tugas berbeda — bukan tiga selera.
 *
 * Archivo lahir dari huruf papan penanda dan rambu; sumbu `wdth`-nya dipakai
 * melebarkan judul sedikit, supaya terbaca seperti penanda batas lahan.
 * Public Sans adalah huruf sistem desain pemerintah — persis register sebuah
 * dokumen kepatuhan. IBM Plex Mono membawa setiap nilai yang bisa dilacak ke
 * sumbernya: hash, UID, koordinat, tanggal.
 */
const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-display',
  display: 'swap',
});

const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const data = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-data',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SNITCH — Living Compliance Attestations',
    template: '%s · SNITCH',
  },
  description:
    'PDF compliance certificates go stale silently. SNITCH issues onchain attestations that revoke themselves when new satellite evidence contradicts them.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${data.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
