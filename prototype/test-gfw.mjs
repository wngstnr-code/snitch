import { collectAlerts, areaHa, pointInPolygon, tilesFor, pickZoom, resolveVersion } from './gfw.mjs';

// --- unit: point-in-polygon dengan lubang ---
const donut = { type:'Polygon', coordinates:[
  [[0,0],[0,10],[10,10],[10,0],[0,0]],
  [[3,3],[3,7],[7,7],[7,3],[3,3]] ]};
console.log('PIP luar   (5,5) dalam lubang → false :', pointInPolygon(5,5,donut) === false ? '✅' : '❌');
console.log('PIP (1,1)  dalam ring luar    → true  :', pointInPolygon(1,1,donut) === true  ? '✅' : '❌');
console.log('PIP (20,20) di luar           → false :', pointInPolygon(20,20,donut) === false ? '✅' : '❌');

// --- unit: luas (1°x1° di ekuator ≈ 12.308.000 ha) ---
const sq = { type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]] };
const a = areaHa(sq);
// 1°x1° di ekuator ≈ 12.309 km² = 1.230.900 ha (1 km² = 100 ha). Toleransi 1,5% (bola vs elipsoid).
console.log(`Luas 1°x1° di ekuator = ${Math.round(a).toLocaleString()} ha (harap ~1.230.900):`,
  Math.abs(a - 1_230_900) / 1_230_900 < 0.015 ? '✅' : '❌');

// --- zoom adaptif ---
console.log('pickZoom(500 ha)=14 :', pickZoom(500)===14?'✅':'❌', '| pickZoom(800k ha)=12 :', pickZoom(800000)===12?'✅':'❌');

// --- versi tersemat (R14) ---
const v = await resolveVersion();
console.log('resolveVersion() →', v, /^v\d{8}$/.test(v)?'✅':'❌');

// --- integrasi: petak nyata di Sarawak ---
const plot = { type:'Polygon', coordinates:[[
  [113.00,2.50],[113.05,2.50],[113.05,2.55],[113.00,2.55],[113.00,2.50]]]};
console.log(`\nPetak uji: ${Math.round(areaHa(plot)).toLocaleString()} ha, zoom ${pickZoom(areaHa(plot))}, ${tilesFor(plot,pickZoom(areaHa(plot))).length} tile`);
const t0 = Date.now();
const r = await collectAlerts(plot);
console.log(`\n✅ collectAlerts: ${r.alerts.length} alert dalam polygon, ${r.tilesScanned} tile, ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(`   versi=${r.version} zoom=${r.zoom} luas=${Math.round(r.areaHa).toLocaleString()} ha`);
console.log(`   setelah cutoff EUDR: ${r.alertsAfterCutoff}`);
if (r.alerts.length) {
  const conf = r.alerts.reduce((m,x)=>(m[x.confidence]=(m[x.confidence]||0)+1,m),{});
  console.log(`   rentang: ${r.alerts[0].date} .. ${r.alerts.at(-1).date}`);
  console.log(`   confidence:`, conf);
  const s = r.alerts[0];
  console.log(`   sampel: ${s.date} @ ${s.lat.toFixed(5)},${s.lon.toFixed(5)} conf=${s.confidence}`);
  const allIn = r.alerts.every(x => pointInPolygon(x.lon, x.lat, plot));
  console.log(`   semua alert benar-benar di dalam polygon:`, allIn ? '✅' : '❌');
}
