# 05 · 降级面处置

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`02b` 已合入。**需要凭据**：不需要。

## 目标

处置在高德模式下无法平移的功能。这些是**产品可感知的行为变化**，不是纯技术改动 ——
每一项都要在 UI 上诚实表达，不能静默失效。

## 一 · 离线瓦片预取：硬关闭

高德服务条款**明确禁止**存储、缓存、抓取其服务数据。这不是「降级」，是「禁止」。

- `client/src/sync/tilePrefetcher.ts`（379 行）：provider 为 `amap` 时不执行。
  入口守卫在 `02a` 已加于 `tripSyncManager.ts`，本包补齐 `tilePrefetcher` 内部的
  防御性检查与相关的 `SyncMeta` 清理。
- `client/vite.config.js` 的 Workbox `runtimeCaching`：**任何规则都不得匹配高德域名。**
  逐条核对现有的 `map-tiles` / `gl-map-styles` / `mapbox-tiles` / `gl-map-offline` 四条规则。
- **UI 必须明示**：离线可用是 TREK 的产品承诺之一，静默失效比明说不支持更伤信任。
  在地图设置页与离线状态提示处加文案：当前底图不支持离线预下载。
  新文案要加进 `shared/src/i18n/` 的**每一个**语言目录，否则 CI 的 i18n 齐全性检查会失败。

## 二 · Studio 图书 / PDF 地图

`client/src/components/Studio/mapTiles.ts` 直接按 XYZ 抓瓦片画进 PDF。同一条款封死。

- 高德模式下回落到该模块**已有的**「矢量国界轮廓」模式 —— 不联网、可任意放大、印刷质量
  反而更好，只是画不出「走过哪条路」。
- 该文件顶部注释已经解释了两种模式的取舍，扩写它，不要另起一套说明。
- 若后续商务确认高德静态图可用于印刷出版物，再单独开包。**本包不做静态图方案。**

## 三 · 自定义底图 URL 设置项

`map_tile_url` 允许用户填任意 XYZ 模板（自托管用户常用）。高德不允许在其底图上叠加第三方
地图数据。

- provider 为 `amap` 时，在地图设置页隐藏该输入项及其预览。
- **不要删除已保存的值** —— 用户切回其它 provider 时应当恢复原样。
- 桌面端 `components/Settings/MapSettingsTab.tsx` 与移动端
  `mobile/screens/settings/MSettingsMap.tsx` **都要改**（本仓库的移动端是独立屏幕）。

## 四 · Atlas 足迹图：保留 Leaflet

`client/src/pages/atlas/useAtlas.ts` 直接 import Leaflet，本就不走引擎开关。

**本包不迁移它。** 理由：它依赖服务端 geoBoundaries 的 WGS84 国界/省界 GeoJSON，叠在
GCJ-02 底图上省界偏移可见；且叠加第三方国界与高德自带国界不一致，存在合规风险。

本包只需**确认**它在 `map_provider = 'amap'` 时仍正常工作（不受开关影响），并在
`docs/amap/README.md` 记录这个例外。

## 五 · 公交换乘：保留 Transitous

同上，与底图 provider 正交，**不动**。确认在 amap 模式下仍可用即可。

## 验收

```bash
pnpm --filter @trek/shared run i18n:parity:strict
pnpm --filter @trek/shared run build
cd client && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run theme:lint
cd client && pnpm run e2e
```

人工验证清单：

- [ ] `amap` 模式下打开行程，DevTools → Application → Cache Storage 中**没有**高德域名的条目
- [ ] 地图设置页显示「不支持离线」提示，自定义底图输入项已隐藏
- [ ] 切回 `mapbox-gl`，自定义底图输入项恢复，且原保存值还在
- [ ] Studio 新建图书的地图元素，在 amap 模式下为矢量轮廓且可正常导出 PDF
- [ ] Atlas 与公交换乘在 amap 模式下正常
