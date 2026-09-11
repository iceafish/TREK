# 地图 provider 覆盖面审计

> 2026-09-08 · 只读排查，不含任何改动。起因：用户在设置中选择 `map_provider = 'amap'`
> 后，行程规划器显示高德，但 `/journey/1` 旅程详情的地图仍是 Leaflet。本文给出直接原因、
> 全应用地图面盘点、根因与处置建议。
>
> **复查 · 2026-09-08**（02b `c907969b`、03 `805f8264`、04 `6f1831af`、05 `096f4a07` 已合入
> dev，HEAD `b48bb70a`）：§2.5 的三项 05 待办**已全部交付**；P1 与 §2.3 的盲视面**全部原样
> 存在**。除 §3 末尾与 §6 git 链两处过时描述已就地更新外，本文仍是现状的准确描述，
> 逐项标注见各节「复查」字样。

## 一句话结论

**`MapViewAuto`（行程规划器家族）的 amap 分支已交付，但 Journey 家族自己的引擎开关
`JourneyMapAuto` 从未加过 amap 分支，且高德版 Journey 渲染器不存在** —— `amap` 在该开关里
不匹配任何 GL 条件，静默落回 Leaflet。此外全仓还有若干地图面**完全绕过引擎开关**硬编码
Leaflet，其中多数既没实现高德、也没被 `05` 的例外清单声明为降级，违反了 05 自己定的
「不能静默失效」原则。

> 复查：05 交付后此结论仍成立 —— 05 只处置了自己点名的降级面（预取 / Studio / 自定义底图
> URL），未触及 Journey 家族、公开分享页与管理端预览。

## 1 · 直接原因：JourneyMapAuto 没有 amap 分支（复查：仍存在）

`client/src/components/Journey/JourneyMapAuto.tsx` 是 Journey 详情页的引擎开关（与规划器的
`MapViewAuto` 同构），但它的分发条件只认 mapbox/maplibre：

```ts
// JourneyMapAuto.tsx:47
const useGL = provider === 'maplibre-gl' || (provider === 'mapbox-gl' && !!token)
```

`provider === 'amap'` 时 `useGL` 为 false，直落第 72 行 `return <JourneyMap … />`（Leaflet）。
**不存在 `JourneyMapAMap` 渲染器** —— Journey 家族现有三套引擎（`JourneyMap` Leaflet /
`JourneyMapGL` mapbox+maplibre），高德是缺位的第四套。

git 证据：`JourneyMapAuto.tsx` 最后一次改动停在 upstream 提交 `33a33e7`（版本号 bump），
amap 系列提交（`1ce3d8f` 坐标层 → `a4b9f60` 设置入口 → `c907969b` 02b → `805f8264` 03 →
`6f1831af` 04 → `096f4a07` 05）全部没有触碰 Journey 家族。

注意排除一个混淆项：`MapViewAuto` 在 `amap_js_key` 未配置时也会静默回落 Leaflet
（`MapViewAuto.tsx:52`），但规划器已能显示高德说明 key 正常，Journey 的问题与此无关。

**影响定性：不是坐标事故。** Leaflet 版 Journey 走 OSM/CARTO 栅瓦（WGS84 对齐），标记位置
是正确的；这是「provider 未生效」的产品一致性问题，不是 WGS84/GCJ-02 错位问题。

## 2 · 全应用地图面盘点

判定基准：是否经过引擎开关（`MapViewAuto` / `JourneyMapAuto`）、开关是否认识 `amap`。

### 2.1 走开关，amap 已生效 ✅

| 面 | 入口 | 说明 |
|---|---|---|
| 行程规划器·桌面 | `pages/TripPlannerPage.tsx:7` → `MapViewAuto` | amap 分支 `MapViewAuto.tsx:51-59`；无 key 回落 Leaflet |
| 行程规划器·移动 | `mobile/screens/trip/map/MMapArea.tsx:2` → `MapViewAuto` | 同上 |
| 收藏集地图 | `components/Collections/CollectionMap.tsx:2` → `MapViewAuto` | 同上 |
| 设置预览·桌面 | `components/Settings/MapSettingsTab.tsx:464` 直挂 `MapViewAMap` | amap 下预览即高德 |
| 设置预览·移动 | `mobile/screens/settings/MSettingsMap.tsx:299` 直挂 `MapViewAMap` | 同上 |

### 2.2 走开关，但开关不认识 amap ❌（本次上报的问题）

| 面 | 入口 | 现状 |
|---|---|---|
| Journey 详情·桌面 | `pages/JourneyDetailPage.tsx:4` + `components/Journey/JourneyDetailPageMapView.tsx:5` → `JourneyMapAuto` | 落回 Leaflet；需 `JourneyMapAMap` 渲染器 + 开关加分支 |
| Journey 详情·移动 App 壳 | `mobile/screens/journey/MJourneyDetail.tsx:3` → `JourneyMapAuto` | 同一开关，同一问题（修一处两者都好） |

> 复查 2026-09-08：仍存在 —— `JourneyMapAuto.tsx:47` 仍无 amap 分支，Journey 目录仍无
> `JourneyMapAMap`。

### 2.3 完全绕过开关，硬编码 Leaflet ❌

| 面 | 入口 | 现状与定性 |
|---|---|---|
| Journey 详情·窄屏分支 | `JourneyDetailPage.tsx:15` → `components/Journey/MobileMapTimeline.tsx:3` 直用 `JourneyMap` | 连 mapbox/maplibre 也不跟随（upstream 既有行为），amap 下同样 Leaflet |
| Journey 公开分享页 | `pages/JourneyPublicPage.tsx:26,28` 直用 `JourneyMap` / `MobileMapTimeline` | provider 全盲（对 mapbox 用户也如此，属 upstream 既有），amap 下 Leaflet |
| 行程公开分享页 | `pages/SharedTripPage.tsx:20` 自建 react-leaflet 地图，`:194` 钉死 `resolveBasemap(null, OFM_POSITRON)`，`:497-499` 只分支 `vector`/`raster` | provider 全盲；`tileUrl.ts:92-100` 专为它准备的 `AMAP_BASEMAP` kind **至今零消费者** |
| 管理端默认设置预览 ×2 | `components/Admin/DefaultUserSettingsTab.tsx:370`、`mobile/screens/admin/MAdminDefaultUserSettings.tsx:326` 直挂 `MapView` | 表单已认识 amap（`:403` / `:221` 有选项），预览却仍是 Leaflet —— 轻微 UX 不一致 |

> 复查 2026-09-08：四行全部原样存在；`AMAP_BASEMAP`（`tileUrl.ts:100`）仍零消费者。

### 2.4 设计例外（有文档依据）✅

- **Atlas** `pages/atlas/useAtlas.ts:366`：直接 import Leaflet，`05` §四 明确保留
  （geoBoundaries WGS84 国界叠 GCJ-02 底图会偏移 + 合规风险）。
- **公交换乘** Transitous：`05` §五，与底图 provider 正交，保留。

### 2.5 计划内待办 —— 复查：05 包（`096f4a07`）已交付，三项全部完成 ✅

- **Studio 图书/PDF 地图**：amap 模式已整段回落矢量国界轮廓，
  `mapTiles.ts:15-22` 顶部注释已扩写 AMap 回落段。
- **自定义底图 URL 隐藏**：amap 下 `map_tile_url` 输入项与预览已隐藏，并显示
  `settings.mapAmapOfflineHint` 明示提示（23 locale 齐全）；已存值保留，切回即恢复。
- **`tilePrefetcher.ts` 内部防御检查**：`tilePrefetcher.ts:333` 已加 amap 硬关闭守卫
  （含 `tilesBbox` 清理），与 `tripSyncManager.ts` 入口守卫形成双保险。

## 3 · 根因：施工包覆盖缺口，不是实现走样

已交付的包只定义了**规划器家族**的范围：

- `02a`/`02b` 的验收对象都是 `MapViewAuto` → `MapView / MapViewGL / MapViewAMap`；
- `05` 的例外清单点名了 Atlas 和公交，**没有点名 Journey 家族、公开分享页、管理端预览**。

结果是这些面处在「既没实现、也没声明降级」的中间态。`05` 开头写明处置原则是「每一项都要在
UI 上诚实表达，不能静默失效」，而现状正是它要避免的静默：同一用户规划器看高德、旅程看
OSM，UI 无任何提示。

**这不是某个 agent 偷懒，而是包拆分时「地图面 ≠ 规划器」的覆盖盲区** —— `MapViewAuto` 是
显眼的扩展点（02a 关键背景一节即引用它），JourneyMapAuto 这个第二开关没有进入任何包的
文件清单。

> 复查更新（2026-09-08）：上文「02b 进行中改动」已过时 —— 02b 已提交合入 dev（`c907969b`），
> 规划器 amap 的路线/预订/POI/插件叠加层均已落地；当前工作树仅本审计文件未跟踪。

## 4 · 同类问题分级

| 级 | 项 | 理由 | 复查 2026-09-08 |
|---|---|---|---|
| P1 | `JourneyMapAuto` 缺 amap 分支 + 无 `JourneyMapAMap` | 登录用户主路径，provider 选中即触发，无提示 | 仍存在 |
| P2 | `MobileMapTimeline`、`JourneyPublicPage`、`SharedTripPage` 硬编码 Leaflet | 用户可见面 provider 全盲；其中公开页对 GL 用户也盲，属既有债务，但 amap 默认化后暴露面变大 | 仍存在 |
| P3 | 管理端默认设置预览 ×2 | 仅预览不一致，表单与保存行为正确 | 仍存在 |
| 待办 | 05 §一/二/三 三项 | 已有包认领，未开工 | ✅ 已全部交付（05 `096f4a07`） |

## 5 · 处置建议（复查：四条均未实施，仍待拍板）

1. **Journey 主路径**：新建施工包（建议编号 `02c`，前置 `02b` 合入）：实现
   `JourneyMapAMap`（条目 pin、checkin、GPX 轨迹白描边、照片层、day 配色 —— 以
   `JourneyMapGL.tsx` 为契约蓝本），`JourneyMapAuto` 加 amap 分支（含无 key 回落 + ErrorBoundary
   + Suspense 结构，照抄 `MapViewAuto`）。坐标纪律同 02a：入口 `toAMap`、回调 `fromAMap`。
2. **其余盲视面二选一，且必须显式**：
   - 迁移：公开分享页若要求跟随 provider，需先回答「匿名访客 + amap key 前端可见 + 高德
     key 域名白名单」的合规/安全账（`SharedTripPage` 还需把 `resolveBasemap` 调用改为
     provider 感知并消费 `AMAP_BASEMAP`，`tileUrl.ts` 的三 kind 设计本就是为此铺的）；
   - 或声明降级：把 Journey 窄屏分支、两个公开分享页写进 `05` 例外清单（与 Atlas 同等待遇），
     并在对应页面 UI 明示当前底图，不静默。
3. **管理端预览**：小改，`DefaultUserSettingsTab` / `MAdminDefaultUserSettings` 的预览分支
   照抄设置页的 amap 预览即可，可并入任一包的收尾。
4. **流程补丁**：在 `docs/amap/README.md` 的包清单或 `05` 中补一条「新施工包必须先全仓枚举
   `L.map(` / `react-leaflet` / 引擎开关消费方，逐面归类：迁移 / 例外声明」，防止第三处
   `JourneyMapAuto` 式的第二开关再被漏掉。

## 6 · 证据索引

- 开关缺分支：`client/src/components/Journey/JourneyMapAuto.tsx:40-48,72`
- 规划器开关（对照）：`client/src/components/Map/MapViewAuto.tsx:51-59`
- Journey 渲染器家族：`client/src/components/Journey/{JourneyMap,JourneyMapGL}.tsx`（无 AMap 变体）
- 硬编码 Leaflet：`MobileMapTimeline.tsx:3`、`JourneyPublicPage.tsx:26,28`、`SharedTripPage.tsx:20,194,497`、`DefaultUserSettingsTab.tsx:370`、`MAdminDefaultUserSettings.tsx:326`
- 设置页 amap 预览（对照，已做对）：`MapSettingsTab.tsx:464`、`MSettingsMap.tsx:299`
- 死导出：`client/src/utils/tileUrl.ts:92-100`（`AMAP_BASEMAP` 零消费者）
- 预取守卫（已做）：`client/src/sync/tripSyncManager.ts:236,298`
- provider 枚举（服务端已就位）：`server/src/nest/settings/settings.service.ts:76`
- git：`JourneyMapAuto.tsx` 最后改动 `33a33e7`；amap 提交链 `1ce3d8f → a4b9f60 → c907969b →
  805f8264 → 6f1831af → 096f4a07 → b48bb70a` 仍未触及 Journey 家族
