# 04 · 路径规划服务端化

> 开工前先读 [00-constraints.md](00-constraints.md)。

**前置**：`03` 已合入。**需要凭据**：Web服务 key。

**本包必读的 skill 参考**：
`references/routing.md` · `references/api/routing.md`

## 目标

把路径规划从「浏览器直连 OSRM」改为「经本站服务端调高德」。

## 为什么这一步是净收益

`client/src/components/Map/RouteCalculator.ts`（405 行）目前直接 `fetch()` 公共 OSRM 实例。
这违反 CLAUDE.md 明文规定的「组件禁止直接调用外部服务」，是文档里点名的既有技术债。

高德接入**必须**走服务端（密钥保护 + 服务条款），所以这一步顺带把旧债修掉。

## 服务端

新增路径规划端点（放在 `maps` 模块下或新建 `routes` 模块，按 `server/src/nest/README.md`
的模块蓝本，以 `weather/` 为参考实现）。

高德的驾车 / 步行 / 骑行接口返回 `steps` + polyline 字符串，需要在服务端解析并拼接成
**现有的 `RouteWithLegs` / `RouteResult` 形状**（见 `client/src/types.ts` 第 161–213 行）。
形状不变，客户端与插件都不感知。

坐标：请求的途经点传出去转 GCJ-02，返回的几何转回 WGS84。契约层往上一律 WGS84。

配额：高德路径规划有调用配额。沿用 `RouteCalculator.ts` 现有的按途经点列表做键的缓存策略，
把缓存搬到服务端（客户端缓存可保留作为第一层）。

## 客户端

`RouteCalculator.ts` 改为调用本站 API，**不改导出的函数签名**：

```
calculateRoute()
calculateRouteWithLegs()
parsePluginProfile()
```

以及 `RouteProfileKey` 类型。上层（日程侧栏的路线切换、地图的路线绘制）零改动。

## 插件 routeProvider 不动

`plugin:<pluginId>/<profileId>` 这条分发路径与内置 profile 是并列的，走
`/api/plugin-routes/:pluginId/:profileId`，与底图 provider 无关。**契约与实现都不要动。**

但插件返回的坐标按 WGS84 解释 —— 渲染时的转换由 `02b` 的宿主侧负责，本包不重复处理。

## 范围提醒

高德路径规划面向中国大陆。本轮范围即为大陆行程，符合。跨境长距离路线不在本轮范围内
（见 README 的已定型前提）。

## 测试

- 服务端：polyline 解析正确性、坐标转换方向、缓存命中、配额失败时的降级行为
- 客户端：`RouteCalculator` 的导出签名未变（这是防回归的关键断言）
- 覆盖率门槛 ≥ 80%

## 验收

```bash
pnpm --filter @trek/shared run build
pnpm --filter @trek/server run typecheck && pnpm --filter @trek/server run test
cd client && pnpm run typecheck && pnpm run test && pnpm run lint
pnpm run test:e2e
```

人工验证：一个多站点日程，切换驾车/步行/骑行，路线绘制正确且贴合道路；
浏览器 network 面板中**不应再出现**任何指向 `router.project-osrm.org` 或
`routing.openstreetmap.de` 的请求。
