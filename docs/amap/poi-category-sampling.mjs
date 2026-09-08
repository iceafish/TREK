#!/usr/bin/env node
/**
 * POI 类别对照抽样 — docs/amap/03-server-provider.md 的映射粒度决策输入。
 *
 * 同一区域（默认：天安门周边）、同一类别键，分别取 Overpass（bbox+tag）与
 * 高德（place/around 中心+半径）各 N 条结果，输出对照报告骨架。
 *
 * 用法（需要 .env 提供真实 AMAP_WEB_SERVICE_KEY，与根目录同源）：
 *   node --env-file=.env docs/amap/poi-category-sampling.mjs
 *
 * 只读外部服务，不写任何数据；高德条款禁止存储服务数据，故本脚本只打印
 * 终端对照，不落盘原始结果。
 */
const KEY = process.env.AMAP_WEB_SERVICE_KEY;
const CENTRE = { lat: 39.9087, lng: 116.3912 }; // 天安门（WGS84）
const RADIUS_M = 1000;
const CATEGORIES = ['restaurant', 'cafe', 'bar', 'hotel', 'sights', 'museum', 'nature', 'activity', 'shopping', 'supermarket'];

// wgs2gcj（与 shared/src/geo/gcj02.ts 同源的公开偏移，抽样用最小实现）
const A = 6378245.0, EE = 0.00669342162296594323;
function tLat(x, y) { let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3; r += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3; return r; }
function tLng(x, y) { let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x)); r += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3; r += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3; return r; }
function wgs2gcj(lat, lng) {
  let dLat = tLat(lng-105, lat-35), dLng = tLng(lng-105, lat-35);
  const rl = lat/180*Math.PI; let m = Math.sin(rl); m = 1 - EE*m*m; const sq = Math.sqrt(m);
  dLat = dLat*180/((A*(1-EE)/(m*sq))*Math.PI); dLng = dLng*180/((A/sq)*Math.cos(rl)*Math.PI);
  return { lat: lat+dLat, lng: lng+dLng };
}

const TYPES = {
  restaurant: '050000', cafe: '050500|050600', bar: '050700', hotel: '100000',
  sights: '110000', museum: '140100|140104|140105', nature: '110100|110200|110300',
  activity: '080000', shopping: '060000', supermarket: '060101|060102',
};
const OVERPASS = {
  restaurant: ['amenity=restaurant', 'amenity=fast_food'], cafe: ['amenity=cafe'], bar: ['amenity=bar', 'amenity=pub', 'amenity=nightclub'],
  hotel: ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house', 'tourism=apartment', 'tourism=motel'],
  sights: ['tourism=attraction', 'tourism=viewpoint', 'historic=monument', 'historic=castle', 'historic=memorial', 'historic=ruins'],
  museum: ['tourism=museum', 'tourism=gallery', 'tourism=artwork', 'amenity=theatre'],
  nature: ['leisure=park', 'leisure=garden', 'natural=beach', 'natural=peak'],
  activity: ['tourism=theme_park', 'tourism=zoo', 'tourism=aquarium', 'leisure=water_park'],
  shopping: ['shop=mall', 'shop=department_store', 'amenity=marketplace'],
  supermarket: ['shop=supermarket', 'shop=convenience'],
};

async function overpass(category) {
  const c = wgs2gcj(CENTRE.lat, CENTRE.lng);
  const dLat = RADIUS_M / 111320, dLng = RADIUS_M / (111320 * Math.cos(CENTRE.lat * Math.PI / 180));
  // Overpass 仍按 WGS84 bbox 查询（与现有实现一致）
  const s = CENTRE.lat - dLat, w = CENTRE.lng - dLng, n = CENTRE.lat + dLat, e = CENTRE.lng + dLng;
  const box = `(${s},${w},${n},${e})`;
  const selectors = OVERPASS[category].map((f) => { const [k, v] = f.split('='); return `  nwr["${k}"="${v}"]${box};`; }).join('\n');
  const q = `[out:json][timeout:20];\n(\n${selectors}\n);\nout center tags ${30};`;
  // 与服务端 resolveOverpassEndpoints 的镜像列表一致（生产代码并行竞速）
  const mirrors = ['https://overpass-api.de/api', 'https://overpass.kumi.systems/api'];
  let lastErr;
  for (const base of mirrors) {
    try {
      const res = await fetch(`${base}/interpreter`, { method: 'POST', headers: { 'User-Agent': 'TREK-sampling/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(30000) });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const text = await res.text();
      const data = JSON.parse(text);
      return (data.elements || []).map((el) => el.tags?.name || el.tags?.brand).filter(Boolean);
    } catch (err) { lastErr = err; }
  }
  throw lastErr ?? new Error('all mirrors failed');
}

async function amap(category) {
  const c = wgs2gcj(CENTRE.lat, CENTRE.lng);
  const p = new URLSearchParams({ location: `${c.lng},${c.lat}`, radius: String(RADIUS_M), types: TYPES[category], offset: '30', page: '1', key: KEY });
  const res = await fetch(`https://restapi.amap.com/v3/place/around?${p}`);
  const data = await res.json();
  if (data.status !== '1') return [`<AMap 拒绝: ${data.info}>`];
  return (data.pois || []).map((poi) => poi.name).filter(Boolean);
}

console.log(`# POI 类别对照抽样 — ${CENTRE.lat},${CENTRE.lng}（WGS84 天安门）r=${RADIUS_M}m\n`);
console.log('| 类别 | Overpass 数 | 高德数 | Overpass 样例（前 5） | 高德样例（前 5） |');
console.log('|---|---|---|---|---|');
for (const category of CATEGORIES) {
  let o, a;
  try { o = await overpass(category); } catch (err) { o = [`<Overpass 失败: ${err.message}>`]; }
  try { a = await amap(category); } catch (err) { a = [`<高德失败: ${err.message}>`]; }
  const cell = (list) => list.slice(0, 5).join('、').replaceAll('|', '\\|') || '（无）';
  console.log(`| ${category} | ${o.length} | ${a.length} | ${cell(o)} | ${cell(a)} |`);
  await new Promise((r) => setTimeout(r, 400)); // 两边都客气一点
}
