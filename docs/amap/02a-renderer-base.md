# 02a · 渲染器 · 基础

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`01` 已合入。**需要凭据**：Web端 JS API key + securityJsCode。

**本包必读的 skill 参考**（`.claude/skills/amap-jsapi-skill/`）：
`SKILL.md` · `references/security.md` · `references/map-init.md` ·
`references/view-control.md` · `references/marker.md` · `references/events.md` ·
`references/api/map.md` · `references/api/marker.md` · `references/api/foundation.md`

## 目标

新增高德渲染器并接进现有的引擎开关，跑通「底图 + 地点标记 + 聚合 + 交互」。
路线、预订叠加、POI、插件图层留给 `02b`。

## 关键背景：扩展点已经存在

- `client/src/components/Map/MapViewAuto.tsx`（44 行）按 `settings.map_provider` 选渲染器，
  目前挂了三套引擎。**加高德是加第四个分支，不是改架构。**
- `client/src/components/Map/glLazy.tsx` 用「组件 × 引擎」的 lazy 绑定切 chunk，引擎作为
  `gl` prop 注入。高德的装载方式不同（运行时注入 script、全局 `window.AMap`，不是 ES 模块），
  所以**新建 `amapLazy.tsx`，不要硬塞进 `glLazy.tsx`**。

## 创建文件

```
client/src/components/Map/engines/amap/loader.ts    JS API 装载封装
client/src/components/Map/engines/amap/coords.ts    出入口转换的唯一通道
client/src/components/Map/MapViewAMap.tsx           渲染器
client/src/components/Map/amapLazy.tsx              lazy 绑定
```

`engines/amap/coords.ts` 是本包唯一允许 import `@trek/shared` 坐标函数的地方（lint 闸门在
`01` 已就位）。所有进出高德的坐标都从这里过，不要在组件里零散调用转换。

## 装载与密钥

- 用 `@amap/amap-jsapi-loader`，类型用 `@amap/amap-jsapi-types`（**不要**用 `any` +
  `eslint-disable`，见 00-constraints）。
- **securityJsCode 绝不能进浏览器。** 用代理模式：

  ```js
  window._AMapSecurityConfig = { serviceHost: '<本站>/_AMapService' }
  ```

  `_AMapService` 是固定前缀，不可省略或修改。服务端转发路由在 `03` 中实现；本包先按此配置，
  与 `03` 约定好路径即可。
- loader 做成**单例**，重复调用返回同一个 promise；**装载失败要能回退**（`MapViewAuto` 已有
  ErrorBoundary + Suspense 双层兜底，把 Leaflet 作为 fallback，沿用该模式）。
- `client/vite.config.js` 的 CSP / `connect-src` 需放行 `*.amap.com`。

## 需实现的 Props（本包部分）

契约与 `MapViewGL.tsx` 的 `Props`（该文件第 91 行起）保持一致，上层调用方不感知渲染器差异。
本包负责：

```
places, dayPlaces, selectedPlaceId, dayOrderMap
onMarkerClick, onMapClick, onMapContextMenu, onViewportChange, onMapReady
center, zoom, fitKey
leftWidth, rightWidth, hasInspector, hasDayDetail
hoverDisabled
```

行为要点：

- **地点标记**：照片圆形头像 + 分类色描边 + 序号徽章。`AMap.Marker` 的 `content` 接受
  DOM/HTML。复用 `MapView.tsx` / `MapViewGL.tsx` 里已有的标记构建逻辑，只换挂载 API。
  **构建 DOM 时用 `textContent`，不要拼 HTML 字符串**（地点名是用户内容）。
- **聚合**：`AMap.MarkerCluster`，支持自定义渲染。点击聚合点应缩放展开。
- **悬浮卡**：跟随光标的名称/分类/地址卡片，与 Leaflet 渲染器行为一致（不是锚定弹窗）。
- **视口自适应**：`map.setFitView()` + `AMap.Bounds`。注意现有的 `computeMapViewport()`
  考虑了左右侧栏宽度（`leftWidth` / `rightWidth` / `hasInspector` / `hasDayDetail`），
  高德侧要达到等价效果。
- **长按 / 右键新增地点**：`onMapContextMenu`。触屏长按后的 `touchend` 不应再触发一次
  `onMapClick`（现有渲染器有这个防抖，照做）。
- **标记拖拽**：仅在非触屏启用（现有渲染器用 `navigator.maxTouchPoints === 0` 判定）。

## 坐标边界（本包的核心纪律）

- 交给高德的每一个坐标：`WGS84 → GCJ-02`。
- 从高德拿回的每一个坐标（`onMapClick` 的 latlng、标记拖拽后的新位置）：
  **`GCJ-02 → WGS84` 之后才调用上层 callback。**
- 结果：`MapViewAMap` 的 callback 契约与另外三个渲染器**完全一致**，上层代码一行不用改。
- 不要在用户没有实际移动 pin 时回写坐标（避免无意义写入与 WebSocket 广播噪音）。

## 需改动的现有文件（仅 4 个，均为加分支）

| 文件 | 改动 |
|---|---|
| `client/src/components/Map/MapViewAuto.tsx` | 加 `amap` 分支 |
| `client/src/utils/tileUrl.ts` | `resolveBasemap()` 需要第三种 kind 或旁路 —— 高德既不是 XYZ 模板，也不是 MapLibre style 文档 |
| `client/src/sync/tripSyncManager.ts` | provider 为 `amap` 时不调用瓦片预取 |
| `client/vite.config.js` | Workbox 规则**不得**匹配高德域名；CSP 放行 `*.amap.com` |

设置层：`map_provider` 枚举加 `'amap'`，共三处 ——
`server/src/nest/settings/settings.service.ts`、`server/src/nest/common/managed.ts`、
`client/src/types.ts`。新增设置键 `amap_js_key`（前端可见）。

> `amap_security_code` 与 `amap_web_service_key` 属服务端机密，**不要**加进
> `DEFAULTABLE_USER_SETTING_KEYS` 或任何会下发到浏览器的合并结果里。它们在 `03` 中处理。

## 测试

参照 `MapView.test.tsx`（1094 行）与 `MapViewGL.test.tsx`（1857 行）的做法：mock 引擎，
断言调用与状态。新渲染器需要同量级的测试覆盖 —— **测试代码量约等于实现代码量**，这是本仓库
的规矩，不能靠降门槛绕过。

坐标边界要有专门的测试：断言传给 `AMap` 的坐标已加偏，断言 `onMapClick` 回调收到的是 WGS84。

## 验收

```bash
pnpm --filter @trek/shared run build
cd client && pnpm run typecheck && pnpm run test && pnpm run lint
cd client && pnpm run lint:pages && pnpm run check:gl-split && pnpm run theme:lint
```

人工验证：切换 `map_provider` 到 `amap`，地图正常渲染，标记位置与高德官方 App 中同一地点
一致（不应有肉眼可见的偏移）；切回其它 provider 一切如常。
