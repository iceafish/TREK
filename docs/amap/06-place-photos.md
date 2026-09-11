# 06 · 服务端地点取图接入高德（统一出口）

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`03` 已合入。**需要凭据**：Web服务 key（复用 `amap_web_service_key`，不新增键）。

**本包必读的 skill 参考**：
`references/api/search.md`（`extensions` base/all 语义）。
`pois[].photos` 字段以官方 **Web 服务**文档为准（`/v3/place/*` 的返回，`extensions=all`
才携带；v5 对应 `show_fields=photos`），并已于 2026-09-11 用真实 key 实测确认：

```bash
KEY=$(grep -m1 '^AMAP_WEB_SERVICE_KEY=' server/.env | cut -d= -f2- | tr -d '"')
curl -sG "https://restapi.amap.com/v3/place/text" \
  --data-urlencode "keywords=故宫博物院" -d "city=北京" -d "offset=1" \
  -d "extensions=all" -d "key=$KEY" | jq '.pois[0] | {name, photos, biz_ext}'
```

返回 `photos: [{ title, url }]`（url 为 `store.is.autonavi.com` 图床直链，https 可用，
`title`/`provider` 未设置时是**空数组**而不是字符串）以及 `biz_ext.rating`、
`biz_ext.opentime2`。

## 目标

amap 模式下，地点封面图（收藏详情面板、行程侧栏头像、地图 marker、PDF 导出、公开分享页）
从高德 POI 图片渠道获取，**复用现有统一出口** —— `PlacePhotoCacheService` +
`GET /api/maps/place-photo/:key/bytes` 字节代理 —— 不改任何客户端代码、不改 `shared/` 契约。

**硬约束（需求方指定）**：该渠道必须持 key 调用；`amap_web_service_key` 未配置时，
渠道一次调用都不得发起，行为与 Google 渠道无 key 时一致（短路后落入 Wikimedia 坐标兜底）。

## 背景：已核实的接缝（不要重新调研，直接按此施工）

1. **统一出口本身 provider 无关**：`photoCache.put/get` 接受任意字符串键、字节进、
   代理 URL 出；`NON_GOOGLE_PLACE_ID` 正则已为 `https://` 直链键兜底；分享页
   （`share.service.ts` 的 `rewritePlacePhotoUrl`）只做 URL 前缀重写。高德图进这套出口
   不需要任何出口侧改动。
2. **id 通道是现成的，唯一断点在 provider 映射**：客户端全链路读
   `google_place_id || osm_id`（添加表单的 `savePlace`/`placeId`、`photoCacheKey`、
   `CollectionPlaceDetail` 的 photoId 拼装）。`places.osm_id`（migration 已补列）与
   `collection_places.osm_id` 两列都在，行程保存路径已持久化 `osm_id`。amap 搜索行的
   `poiToRecord` 目前只给 `amap_id`，不给 `osm_id` —— id 在 pick 的一瞬丢失。
3. **`amap:` 前缀路由有先例**：`details()` 已按 `placeId.startsWith('amap:')` 路由到
   `/v3/place/detail`（maps.service.ts 的 details 分支）；同文件 `pois()` 的 around 路径
   已把 amap id 写进 `osm_id` 槽位并注明 contract parity。
4. **`callAmap` 是现成调用封装**：HTTP 200 envelope 归一化抛错（`status!=='1'` → 502）、
   `AbortSignal` 超时、key 注入。
5. **当前的坑**：`NON_GOOGLE_PLACE_ID` 不含 `amap:`，`isGooglePlaceId("amap:…")` 为
   true —— photo / enrichment / details-expanded 会拿 amap id 打 Google Places 吃
   计费 400。本包先修它。
6. **对 `03` 包的一句修订**：`03` 写「不要动 photo/富化，高德不提供这些字段」——
   photos 字段的存在已证伪其中图片一半；富化（评分/营业时间/描述）仍留二期（见下）。
7. **服务条款边界**：`00-constraints` 的「禁止存储/缓存高德服务数据」适用域是**瓦片与
   渲染**（README 已定型前提「高德模式下瓦片预取硬关闭」）。Web 服务响应的服务端持久化
   已有先例 —— `details()` 的 amap 分支本就把详情写进 `place_details_cache`（7 天 TTL）。
   本包的图片落盘缓存与该先例同构，并在出口处只经自家代理出图、不向客户端暴露图床直链。

## 改动清单

### 1. id 穿通 —— `poiToRecord` 补 `osm_id`（amap.provider.ts）

```ts
google_place_id: null,
amap_id: poi.id ? `amap:${poi.id}` : null,
osm_id: poi.id ? `amap:${poi.id}` : 'amap:unknown',   // 与 pois() 的 contract parity 一致
```

效果（零客户端改动、零 schema 改动）：

- 添加表单 `savePlace` 自动把 `amap:<poiid>` 存进 `collection_places.osm_id`；
- 规划器 `PlaceFormModal` 的 `placeId = google_place_id || osm_id` 自动带上 id，
  details / enrichment 立即可路由；
- `CollectionPlaceDetail` 的 `photoId`、地图 `photoCacheKey` 自动命中。

### 2. 正则修正 —— `NON_GOOGLE_PLACE_ID` 加 `amap:`（maps.helpers.ts）

```
/^(?:coords|node|way|relation|amap):|^https?:\/\/|…/
```

使 `isGooglePlaceId("amap:…")` 为 false，amap id 停止误入 Google 分支。
`detailsExpanded` 已有 `amap:` 前置分支，不受影响；`OSM_PLACE_ID`
（`node|way|relation`）不得吞掉 `amap:`。

### 3. provider 新方法 —— `AmapProvider.photos()`

`/v3/place/detail` + `extensions: 'all'`（现有 `details()` 用默认 base，**拿不到
photos**，必须是独立方法）。规范化：

- `id` 剥 `amap:` 前缀（与 `details()` 同款）；空 id（如 `amap:unknown`）直接返回空；
- `photos[]` 过滤：url 必须是 `http(s)://`；`title`/`provider` 的空数组形态归一化为
  null；
- `http://store.is.autonavi.com/...` 重写为 `https://`（官方文档+实测确认 https 可用；
  服务端抓取后客户端只见代理地址，与混合内容无关）；
- 返回全部候选（`{ title: string | null; url: string }[]`），封面取第一张。

### 4. 服务端分支 —— `getPlacePhoto` 加 `fetchAmapPhoto`（maps.service.ts）

路由按 **id 类型**分流，不是优先级；兜底链不变：

```
磁盘缓存 → 负缓存 / in-flight 去重
→ amap: id   → fetchAmapPhoto()        （新）
→ Google id  → fetchGooglePhoto()      （不动）
→ 都不适用/失败 → fetchWikimediaFallback()（不动，坐标兜底）
→ 全空 → markError + { photoUrl: null }
```

`fetchAmapPhoto`（闭包形态与 `fetchGooglePhoto` 对称）：

- **gate**：`const amapKey = this.resolveAmapKey(); if (!amapKey) return null;`
  —— 未配置 key 不发起任何网络调用（需求硬约束），返回 null 后链路继续走 Wikimedia；
- 取候选：`this.amap.photos({ key: amapKey, placeId })`；
- 候选为空 → `return null`（**不**标 `providerFailed` → 负缓存记 `'no-photo'` 一天，
  与 Google 空结果语义一致）；
- 下载：按序尝试候选，`safeFetchFollow(url, undefined, { bypassInternalIpAllowed: true })`
  （逐跳 SSRF 校验，与 Wikimedia 同通道）；字节非空 → `photoCache.put(placeId, bytes, 'AMap')`
  并返回（`title` 是「春季」这类场景标签、`provider` 为空，不当作者用；credit 统一
  标 `AMap`，与 `Google`/`Wikipedia` 的 attribution 风格一致）；
- 全部候选下载失败 / 接口抛错 → `providerFailed = true` → 负缓存记
  `'provider-error'`（几分钟）；
- 并发：沿用 `acquirePhotoFetchSlot()` 全局槽。detail 调用吃 key 配额（个人 key 约
  3 QPS），磁盘缓存 + 负缓存 + in-flight 去重保证**每个 id 至多打一次 detail**；
  图床字节下载不占 API 配额。

### 5. 语义边界（不改代码，施工时不得破坏）

- **kill-switch**：controller 的 `photosDisabled()` 闸门对一切非 `coords:` id 生效，
  `amap:` id 自动被覆盖 —— 「关闭图片抓取」对全部 provider 生效，fail-closed。
- **纯坐标地点不反查高德**：`photoService` 会为地图上每个 marker 请求一次图，
  坐标级 around 查询会把 QPS/配额乘上 marker 数量。只认显式 `amap:` id。

## 刻意不做（本包边界）

- 纯坐标（右键/GPS/存量无 id 行）不做高德反查；
- 存量数据不回填 poiid（修复前保存的地点继续 Wikimedia/渐变，显式低频动作可接受）;
- enrichment 九宫格与 `biz_ext`（rating / opentime2 → 评分/营业时间 facts）**留二期**
  —— 同一个 `photos()`/detail 调用即可喂 `collectPhotos`，`collectFacts`/`collectHours`
  放宽 `source === 'openstreetmap'` 门控即可，另开一包。

## 测试

`server/src/nest/**` 覆盖率门槛 ≥ 80%。不要写真实调用高德接口的测试，mock HTTP
（`amap.test.ts` / `maps.service.test.ts` 均有现成 harness）：

- provider：`photos()` 的 http→https 重写、`title` 空数组归一化、非 http(s) url 过滤、
  空 pois / `status!=1` 抛错、空 id 短路；
- service：`amap:` id 路由进新分支且不再打 Google；无 amap key 短路（零 fetch 调用）；
  photos 为空 → `no-photo` 负缓存；下载失败 → `provider-error`；attribution 透传；
- 正则：`isGooglePlaceId('amap:B001') === false`；`OSM_PLACE_ID` 不匹配 `amap:`；
- 回归：现有 MAPS-035… 系列照片用例全绿（Google / Wikimedia 行为不变）。

## 验收

```bash
pnpm --filter @trek/shared run build
pnpm --filter @trek/server run typecheck
pnpm --filter @trek/server run test:unit
pnpm run lint
```

人工验证（配好 `amap_web_service_key` 后）：

1. amap 模式搜索「故宫博物院」→ 添加到收藏 → 打开地点详情，header 封面出现高德图片；
2. 服务端日志确认每个地点只发起一次 `/v3/place/detail` 调用（第二次起命中磁盘缓存）；
3. 移除 `amap_web_service_key` 重启后重复步骤 1：服务端**无** restapi.amap.com 请求，
   封面退回 Wikimedia 或渐变底，无报错。
