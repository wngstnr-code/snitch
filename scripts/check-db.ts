import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tidak diset.');
  const sql = neon(url);
  const rows = await sql`
    select table_name, (select count(*) from information_schema.columns c
      where c.table_name = t.table_name and c.table_schema = 'public') as cols
    from information_schema.tables t
    where table_schema = 'public' order by table_name`;
  console.log('host  :', new URL(url).host);
  for (const r of rows) console.log(`  ${r.table_name} (${r.cols} kolom)`);
}
main().catch((e) => { console.error('GAGAL:', e instanceof Error ? e.message : e); process.exit(1); });
