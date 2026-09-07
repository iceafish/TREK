# 02b · 渲染器 · 叠加层

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`02a` 已合入。**需要凭据**：同 `02a`。

**本包必读的 skill 参考**：
`references/vector-graphics.md` · `references/info-window.md` · `references/context-menu.md` ·
`references/layers.md` · `references/custom-layers.md` · `references/api/vector-graphics.md`
（含 `GeoJSON` 类）· `references/api/overlay-group.md` · `references/api/layers-custom.md`
（`LabelsLayer` 避让）

## 目标

补齐高德渲染器剩余的叠加层：日程路线、预订/交通叠加、POI 探索、插件贡献点。

## 需实现的 Props（本包部分）

```
route, routeSegments, routeVias
reservations, visibleConnectionIds, showTransitRoutes, showReservationStats, onReservationClick
days, selectedDayId
pois, onPoiClick
tripId            // 启用插件地图贡献点
```

## 分项要求

**日程路线折线**
`AMap.Polyline`，支持 `isOutline` / `outlineColor` / `strokeStyle`，做出现有渲染器的
「深色描边 + 亮色内芯」双层效果。手动轨迹色（`place.route_color`，见 `trackColors.ts`）
要生效。`routeVias`（插件路线上的充电站/服务区）用小圆点标记，视觉上不能压过日程站点。

**预订 / 交通叠加**
对应 `ReservationOverlay.tsx` 与 `reservationsMapbox.ts`。十种交通类型各有图标与端点标记。
航班、邮轮、渡轮走大圆弧 —— 几何计算复用 `flightGeodesy.ts`（纯数学，与引擎无关）。

> **验证跨 180° 经线的分段。** 现有实现在 Web Mercator 下工作，高德的投影行为需要实测确认
> 弧线不会横穿整张地图。本轮只做大陆行程，优先级不高，但要留测试用例。

**POI 探索**
`usePoiExplore.ts` 的数据来自服务端 `/api/maps/pois`，本包只负责渲染：小号彩色针脚 +
悬浮弹窗，颜色取自 `poiCategories.ts` 的 `color` 字段（与 pill 保持一致）。
`onViewportChange` 需上报 bbox，供「搜索此区域」使用。

> POI 的**数据源**替换在 `03`。本包按现有 `Poi` 接口渲染即可。

**插件地图贡献点**
`mapMarkerProvider`（点）与 `mapLayerProvider`（面/线，GeoJSON）。宿主侧渲染改用
`AMap.GeoJSON` / `AMap.Marker`；插件层要插在日程路线**之下**，不能盖住主路线。

> **契约不变。** 插件交换的是 GeoJSON 与经纬度数组，与引擎无关。但必须在插件 SDK 文档中
> 明确写清：**插件返回的坐标一律按 WGS84 解释，转换由宿主负责。** 这条不写清楚，第三方
> 插件的图层会整体偏移几百米。

## 坐标边界

与 `02a` 同一条纪律，且本包的面更大 —— 路线几何、预订端点、POI 点、插件 GeoJSON 的**每一个
顶点**都要经过转换。GeoJSON 尤其容易漏：要递归处理 `Point` / `LineString` / `Polygon` /
`MultiPolygon` 的全部坐标数组。

建议在 `engines/amap/coords.ts` 中提供 `transformGeoJson()` 工具函数，避免各处自己遍历。

## 主题一致性

高德的 `InfoWindow` 自带样式。用 `isCustom: true` 自绘内容，接住用户选择的配色方案、透明度
与字号（`theme:lint` 要求走外观令牌）。地图内的样式例外沿用现有的 `theme-lint-disable`
行注释机制 —— 那是既有惯例，不是新开口子。

## 验收

```bash
pnpm --filter @trek/shared run build
cd client && pnpm run typecheck && pnpm run test && pnpm run lint
cd client && pnpm run lint:pages && pnpm run check:gl-split && pnpm run theme:lint
cd client && pnpm run e2e
```

人工验证：一个含多日程、多预订（含航班）、开启 POI 探索的行程，在 `amap` 与 `mapbox-gl`
两个 provider 下切换，叠加层的**位置**一致、**视觉层级**一致。
