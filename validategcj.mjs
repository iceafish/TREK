/**
 * GCJ-02 公开实现 vs 高德官方变换 —— 基准验证
 *
 * 用法：  AMAP_KEY=你的Web服务key node validate-gcj.mjs
 *
 * 高德不提供 GCJ-02 → WGS84，但提供 WGS84 → GCJ-02（坐标转换 Web 服务）。
 * 正向接口即可充当 oracle，据此测出三件事：
 *
 *   实验 1  正向近似误差 : |f_local(W) − f_amap(W)|
 *           → 影响「库里的 WGS84 点画到高德底图上」的位置准确度
 *   实验 2  逆向近似误差 : |f_local⁻¹(f_amap(W)) − W|
 *           → 影响「高德返回的 POI 转成 WGS84 存库」的位置准确度
 *   实验 3  闭环抵消验证 : |f_local(f_local⁻¹(G_amap)) − G_amap|
 *           → 「高德查到 → 存库 → 画回高德」的闭合度；应为亚毫米，
 *             且与实验 1/2 的近似误差无关（同一套 f 正反使用，误差抵消）
 *
 * 判定门槛（建议）：实验 1/2 的 p95 < 5 m 且 max < 10 m 即可放行；
 * 实验 3 的 max 必须 < 0.01 m，否则是实现 bug 而非近似误差。
 */
const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;

const tLat = (x, y) => {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI)) * 2/3;
  r += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI)) * 2/3;
  r += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30)) * 2/3;
  return r;
};
const tLng = (x, y) => {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI)) * 2/3;
  r += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI)) * 2/3;
  r += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI)) * 2/3;
  return r;
};
const outOfChina = (lat, lng) => !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);

function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const rad = lat / 180 * PI;
  let magic = Math.sin(rad); magic = 1 - EE * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sq) * PI);
  dLng = (dLng * 180) / (A / sq * Math.cos(rad) * PI);
  return [lat + dLat, lng + dLng];
}
/** 不动点迭代求逆：压缩映射，3 次即亚毫米。 */
function gcj2wgs(gLat, gLng, iters = 3) {
  if (outOfChina(gLat, gLng)) return [gLat, gLng];
  let lat = gLat, lng = gLng;
  for (let i = 0; i < iters; i++) {
    const [pLat, pLng] = wgs2gcj(lat, lng);
    lat = gLat - (pLat - lat); lng = gLng - (pLng - lng);
  }
  return [lat, lng];
}
const meters = (aLat, aLng, bLat, bLng) => {
  const R = 6371008.8, dLat = (bLat-aLat)*PI/180, dLng = (bLng-aLng)*PI/180;
  const m = Math.sin(dLat/2)**2 + Math.cos(aLat*PI/180)*Math.cos(bLat*PI/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(m));
};

// 大陆样本：覆盖东西南北与不同纬度带。可自行扩充；每 40 个一批。
const PTS = [
  ['天安门 北京', 39.908700, 116.391200], ['首都机场', 40.079600, 116.603100],
  ['外滩 上海', 31.239300, 121.490500], ['浦东机场', 31.143400, 121.805300],
  ['广州塔', 23.106000, 113.324500], ['深圳湾', 22.510000, 113.930000],
  ['西湖 杭州', 30.242000, 120.148000], ['夫子庙 南京', 32.023000, 118.788000],
  ['黄鹤楼 武汉', 30.544700, 114.302500], ['宽窄巷子 成都', 30.669000, 104.056000],
  ['解放碑 重庆', 29.557000, 106.577000], ['大雁塔 西安', 34.218000, 108.964000],
  ['大昭寺 拉萨', 29.653000, 91.132000], ['喀什老城', 39.470000, 75.990000],
  ['乌鲁木齐', 43.825000, 87.616000], ['敦煌莫高窟', 40.041000, 94.809000],
  ['三亚湾', 18.240000, 109.500000], ['海口', 20.044000, 110.199000],
  ['漠河', 53.470000, 122.350000], ['哈尔滨中央大街', 45.776000, 126.617000],
  ['大连星海湾', 38.877000, 121.545000], ['青岛栈桥', 36.058000, 120.312000],
  ['厦门鼓浪屿', 24.447000, 118.067000], ['丽江古城', 26.876000, 100.234000],
  ['桂林象鼻山', 25.259000, 110.297000], ['张家界', 29.117000, 110.479000],
  ['呼和浩特', 40.842000, 111.749000], ['银川', 38.487000, 106.230000],
  ['西宁塔尔寺', 36.492000, 101.573000], ['贵阳甲秀楼', 26.573000, 106.708000],
];

const KEY = process.env.AMAP_KEY;
if (!KEY) { console.error('缺少 AMAP_KEY 环境变量（高德 Web 服务 key）'); process.exit(1); }

const r6 = n => Number(n.toFixed(6));            // 接口限 6 位小数，先量化再比对
const stats = a => { const s=[...a].sort((x,y)=>x-y);
  return { mean: a.reduce((p,c)=>p+c,0)/a.length, p95: s[Math.floor(s.length*0.95)] ?? s.at(-1), max: s.at(-1) }; };

const rows = [];
for (let i = 0; i < PTS.length; i += 40) {
  const batch = PTS.slice(i, i + 40);
  const locs = batch.map(([, lat, lng]) => `${r6(lng)},${r6(lat)}`).join('|');
  const url = `https://restapi.amap.com/v3/assistant/coordinate/convert`
    + `?locations=${encodeURIComponent(locs)}&coordsys=gps&output=json&key=${KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== '1') { console.error('接口失败:', data.info, data.infocode); process.exit(1); }
  const out = String(data.locations).split(/[;|]/);
  batch.forEach(([name, lat, lng], k) => {
    const [oLng, oLat] = out[k].split(',').map(Number);   // 官方 GCJ-02
    const W = [r6(lat), r6(lng)];
    const [fLat, fLng] = wgs2gcj(W[0], W[1]);             // 本地正向
    const e1 = meters(oLat, oLng, fLat, fLng);            // 实验 1
    const [bLat, bLng] = gcj2wgs(oLat, oLng, 3);          // 本地逆向（作用于官方 GCJ）
    const e2 = meters(W[0], W[1], bLat, bLng);            // 实验 2
    const [cLat, cLng] = wgs2gcj(bLat, bLng);             // 再正向回去
    const e3 = meters(oLat, oLng, cLat, cLng);            // 实验 3（闭环抵消）
    rows.push({ name, offset: meters(W[0], W[1], oLat, oLng), e1, e2, e3 });
  });
}

const fmt = (v, w = 9) => (v < 0.001 ? v.toExponential(1) : v.toFixed(3)).padStart(w);
console.log('\n点位              官方位移(m)   实验1正向   实验2逆向   实验3闭环');
console.log('─'.repeat(72));
for (const r of rows) console.log(r.name.padEnd(16) + fmt(r.offset, 10) + fmt(r.e1, 12) + fmt(r.e2, 12) + fmt(r.e3, 12));

console.log('\n汇总 (m)          平均        p95         最大');
console.log('─'.repeat(52));
for (const [label, key] of [['实验1 正向近似', 'e1'], ['实验2 逆向近似', 'e2'], ['实验3 闭环抵消', 'e3']]) {
  const s = stats(rows.map(r => r[key]));
  console.log(label.padEnd(16) + fmt(s.mean, 10) + fmt(s.p95, 12) + fmt(s.max, 12));
}
const s1 = stats(rows.map(r => r.e1)), s2 = stats(rows.map(r => r.e2)), s3 = stats(rows.map(r => r.e3));
const pass = s1.p95 < 5 && s1.max < 10 && s2.p95 < 5 && s2.max < 10 && s3.max < 0.01;
console.log(`\n判定：${pass ? '通过 — 可按方案实施' : '未通过 — 需复核实现或调整门槛后再决策'}`);
console.log('（门槛：实验1/2 的 p95 < 5 m 且 max < 10 m；实验3 的 max < 0.01 m）');
