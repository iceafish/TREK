# 03 · 服务端 provider

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`01` 已合入。**需要凭据**：Web服务 key + securityJsCode。
**可与 `02` 并行。**

**本包必读的 skill 参考**：
`references/security.md`（**代理转发一节给了 Node.js + Express 的完整写法，直接参照**）·
`references/geocoder.md` · `references/search.md` · `references/api/services.md`

## 目标

在服务端把地点检索、自动补全、详情、逆地理编码、POI 探索的数据源切换到高德，
并实现 `_AMapService` 安全码代理路由。

## 关键背景：这是整个方案里最干净的一块

`server/src/nest/maps/maps.controller.ts` 已经是稳定的代理层，`shared/src/maps/maps.schema.ts`
把返回的地点对象刻意定义成 `z.record(z.string(), z.unknown())`，注释写明「provider-shaped，
按设计保持开放」。

**因此：控制器、`shared/` 契约、客户端调用三者零改动。** 只在 `MapsService` 里加一个 provider
分支。这是原作者为多 provider 预留的，不要重新设计这一层。

## 创建文件

```
server/src/nest/maps/providers/amap/amap.provider.ts      检索/补全/详情/逆地理/POI
server/src/nest/maps/providers/amap/amap.categories.ts    POI 类别映射表
server/src/nest/maps/providers/amap/coords.ts             出入口转换的唯一通道
server/src/nest/maps/amap-proxy.middleware.ts             _AMapService 转发
```

`providers/amap/coords.ts` 是服务端唯一允许 import `@trek/shared` 坐标函数的地方
（lint 闸门在 `01` 已就位）。

## provider 需覆盖的方法

对应 `MapsService` 现有的对外方法（见 `maps.service.ts` 的「Controller-facing surface」段）：

| 现有方法 | 高德对应 |
|---|---|
| `search` | POI 搜索（关键字） |
| `autocomplete` | 输入提示 |
| `details` / `detailsExpanded` | POI 详情 |
| `reverse` | 逆地理编码 |
| `pois` | POI 周边/多边形搜索 |

**不要动的方法**：`photo` / `photoBytesKey` / 富化相关。地点富化（图片、维基描述、
11 类 OSM facts）依赖 OSM tags 与 Wikimedia，高德不提供这些字段。该链路只需要地点名 +
WGS84 坐标，与底图 provider 正交，**保留不动**（见 README 的已定型前提）。

## 坐标边界

**高德返回的坐标是 GCJ-02，必须在 provider 内部就转回 WGS84，再交给控制器。**
契约层往上一律 WGS84。

同理，带位置偏好的请求（`locationBias`、POI 的 bbox）传给高德之前要转成 GCJ-02。

## POI 类别映射

现状：`client/src/components/Map/poiCategories.ts` 定义 8 个类别键
（`restaurant` / `cafe` / `bar` / `hotel` / `sights` / `museum` / `nature` / `activity`），
键是与服务端的契约，服务端侧的 OSM tag 映射在 `maps.service.ts` 的 `CATEGORY_OSM_FILTERS`。

高德是 POI **类型码**体系，与 OSM tag 完全不同。需要新建一张 8 键 → 高德类型码的映射表。

> **这是用户可感知的行为变化。** Overpass 是 bbox + OSM tag，高德是中心点+半径或多边形搜索，
> 结果密度与覆盖会明显不同。**先做一次对照抽样**（同一区域、同一类别，两边各取结果做人工
> 比较），把差异整理成一份对照报告，交产品确认后再定映射粒度。不要自行决定「差不多就行」。

客户端的 8 个类别键**不要改** —— 改了就动了契约，会波及 i18n 与 UI。

## `_AMapService` 代理

- 挂载位置：`server/src/bootstrap.ts` 中 **`app.init()` 之前**的裸 Express 中间件区
  （与现有 `/mcp` 原始 body 透传同一区域）。Nest 路由对未匹配路径抛 `NotFoundException`，
  不会向后穿透，所以挂在 init 之后无效。
- 转发时注入 `jscode`（securityJsCode）。**该值绝不下发浏览器。**
- **公开分享页 `SharedTripPage` 是匿名可达的**，这条路由必须对未登录用户开放。
  因此：单独限流 + 只放行地图必需的路径前缀，避免变成开放代理。
- 路由需通过 `validate-route-guards.ts` 的启动期闸门（未知的 public 路由会被拒绝）。

## 密钥

复用 `resolveApiKey()` 的三级体系（环境变量 → 实例级设置 → 用户自有）。新增：

| 设置键 | 可见性 |
|---|---|
| `amap_js_key` | 前端可见（在 `02a` 中已加） |
| `amap_security_code` | **服务端机密** |
| `amap_web_service_key` | **服务端机密** |

后两个**不得**加入 `DEFAULTABLE_USER_SETTING_KEYS`，也不得出现在任何下发到浏览器的合并
设置结果中。参照 `isAdminOnlyLlmSetting()` 的处理方式。

## 测试

`server/src/nest/**` 覆盖率门槛 ≥ 80%。参照 `server/src/nest/README.md` 的测试分层
（unit / parity / e2e）。重点：

- provider 返回的坐标必须是 WGS84（这是最容易回归的一条）
- 契约形状与替换前一致（parity 测试）
- 代理路由的匿名可达性与限流
- 不要写真实调用高德接口的测试，mock HTTP

## 验收

```bash
pnpm --filter @trek/shared run build
pnpm --filter @trek/server run typecheck
pnpm --filter @trek/server run test
pnpm run test:e2e
pnpm run lint
```

人工验证：搜索一个已知地点，返回坐标与该地点真实 WGS84 位置一致（不带 GCJ-02 偏移）；
在 `amap` 渲染器下该地点落在正确位置。
