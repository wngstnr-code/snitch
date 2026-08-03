import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Repo ini punya lockfile sendiri; kunci root supaya Turbopack tidak
  // salah menebak workspace dari lockfile di direktori induk.
  turbopack: { root: __dirname },
};

export default nextConfig;
