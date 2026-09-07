# 共用约束 —— 每个包开工前必读

本文件是高德接入所有工作包共用的仓库约束与禁令。各包 brief 只写该包特有的部分，这里的内容
默认适用。

## 本仓库的定位（先看这条，它会改变你对其它规则的理解）

**本仓库是一个独立维护的目标仓库，不向上游 TREK 提交任何内容。** 它 fork 自
`github.com/TREK`，但没有配置 upstream 远端，也不打算回流 —— 目标是按自身需求迭代出一个
中国大陆本地化的版本。

因此，根目录 `CLAUDE.md` 的「Conventions (from CONTRIBUTING.md)」一节
（Discord 预先讨论、必须关联 issue、PR 模板、目标分支、不得有破坏性变更）描述的是**上游项目
接收外部投稿的流程，对本仓库不适用**。不要因为读到那一节就去找 issue 编号或改投稿分支。

**仍然适用、且本仓库自己也要守的**，是那一节里关于工程质量的部分：测试必备、
`src/nest/**` 覆盖率 ≥ 80%、一次提交只做一件事、不做无关的重排和重构。这些不是因为上游要求，
而是本仓库自己的标准。

集成分支是 `dev`。工作分支从 `dev` 切出，完成后合回 `dev`。

## 高德实现必须依据官方 skill

本仓库已安装高德官方 skill：`.claude/skills/amap-jsapi-skill/`（随仓库提交，`.gitignore`
已对 `.claude/skills/` 开口，因此 worktree 与新克隆中都在）。

**任何涉及高德 API 的实现，必须先查该 skill 中对应的参考文件，按其中的写法落地，不要凭记忆
写 `AMap` 调用。** 各包 brief 顶部列出了该包对应的参考文件。

skill 覆盖地图生命周期、安全配置、视图控制、覆盖物、图层、事件、地理编码、路径规划、POI
搜索，另有一份按类组织的 API 参考（`references/api/`）。示例代码均经官方验证。

三条从 skill 中提取、与本项目直接相关的硬要求：

- **组件卸载时必须调用 `map.destroy()`**，否则 WebGL 上下文泄漏。在 React 里就是 effect 的
  cleanup 函数 —— 现有 Leaflet / GL 渲染器都有等价处理，照做。
- **按需声明 plugins**：`AMapLoader.load({ plugins: [...] })` 只列真正用到的。本项目对首屏
  体积敏感（现有 GL 引擎按引擎切 chunk 就是为此）。
- **生产环境必须用 `serviceHost` 代理**，`securityJsCode` 不得进浏览器。skill 的
  `references/security.md` 给了 Nginx / Node.js / Java 三种代理写法，其中 Node.js 版与本项目
  `03` 包的中间件形态一致，可直接参照。

> **一个需要项目负责人拍板的细节**：skill 示例中有一行埋点
> `AMap.getConfig().appname = 'amap-jsapi-skill'`，用于统计 skill 调用来源，会把该标识发给
> 高德。本项目是自托管产品，建议改成自己的应用标识或移除。**agent 不要自行保留原值，
> 遇到时停下来问。**

## 仓库门禁（不得绕过）

- **`shared/` 必须先构建**，否则 server / client 的 typecheck 跑不起来：
  `pnpm --filter @trek/shared run build`
- **不得新增 `any`**，不得新增 `eslint-disable`，不得下调任何 lint 规则严重级别或覆盖率门槛。
  这是 CLAUDE.md 明文规定：「Fail closed, gates stay on」。
- **`server/src/nest/**` 覆盖率门槛 ≥ 80%**，由 vitest 强制。新增服务端代码需要配套测试。
- **i18n 齐全性**：任何新增的界面文案必须加进 `shared/src/i18n/` 下的**每一个**语言目录，
  否则 `i18n:parity:strict` 会让 CI 失败。`en/` 是基准。
- **commit 用 conventional commits**（`feat(maps): ...` / `fix(maps): ...`）。
- 客户端还有三条专项检查，改到相关区域时必须通过：
  `pnpm run lint:pages`（Page 模式）、`pnpm run check:gl-split`（引擎分包）、
  `pnpm run theme:lint`（外观令牌）。

## 架构规矩（CLAUDE.md 摘要）

- **数据流不许跳层**：component → feature hook → store/slice → `repo/` → `api/` | Dexie。
  组件和弹窗**禁止**直接 import `api/client` 或裸 fetch/axios，写操作尤其禁止。
- **契约唯一真值在 `shared/`**：改 API 形状要先改 `shared/src/<domain>/<domain>.schema.ts`，
  重新构建，然后两侧引用推断类型。
- **连通性判定只认 `isEffectivelyOffline()`**，功能代码禁止直接读 `navigator.onLine`。
- **禁止 `window` CustomEvent 总线和全局可变 `window` 状态。**
- **渲染安全**：绝不把用户内容拼进 HTML 字符串（地图 tooltip / InfoWindow 也算），
  用 DOM + `textContent` 构建。
- **乐观写必须对账**：失败要回滚并给用户可见提示。禁止 `.catch(() => {})` 或裸 `catch {}`。

## 坐标铁律（贯穿所有包）

1. **数据库、Dexie、mutationQueue、REST 契约、GPX/KML 进出、插件契约 —— 一律 WGS84。**
   任何情况下都不迁移库中已有坐标。
2. **GCJ-02 只允许存在于渲染边界之内**：交给高德之前转出去，从高德拿回来立刻转回来。
3. **正反变换必须同源本地实现。禁止使用 `AMap.convertFrom` 或任何在线转换接口。**
   正反同源时近似误差会完全抵消（实测闭环误差 0.03 毫米）；一旦一边本地一边在线，抵消被破坏，
   系统性偏差就会暴露出来。在线接口另有单次 40 点、日配额、网络往返三重限制 —— 一个 200 地点
   的行程光首屏就要 5 次调用。
4. **禁止「修正」西部地区约 7 米的近似误差。** 它低于消费级 GPS 3–10 米的噪声本底，且任何
   「修正」都会污染天气查询、`tz-lookup` 时区判定、Atlas 国界 point-in-polygon 这些非地图
   消费者的输入。

## 高德服务条款

- **禁止存储、缓存、抓取高德的服务数据。** 这不是「降级」而是「禁止」：瓦片预取、Service
  Worker 缓存、把瓦片画进 PDF，在高德模式下全部不可做。
- 只能使用官方文档列明的功能来展示服务数据。

## 提交卫生

- **一个包一个分支，分支名 `feat/amap-<包号>-<简述>`。**
- **只提交本包 brief 中列出的文件。** 严禁 `git add -A` / `git commit -a` ——
  工作区里可能存在与本包无关的未提交改动，把它们扫进来会让提交标题与内容不符，
  后续包在脏基础上继续，越往后越难拆分和回滚。提交前用 `git status` 逐项确认。
- **不要在仓库根目录留下临时脚本或产物。** 验证脚本属于 `docs/amap/`。
- 一个包完成后**停下来**，不要自动开始下一个包。

## 不要做的事

- **不要改动或删除现有的 Leaflet / Mapbox / MapLibre 渲染器。** 这是 2026-09-08 已拍板的
  边界，不是待议选项。方案是新增第四个 provider，不是替换。现有引擎是高德不可用时的兜底，
  也是未来境外场景的退路。
- **不要照抄 `MapViewGL.tsx` 的 `gl: any` 模式。** 那里为了同时容纳两个 SDK 用了
  `eslint-disable`。高德有官方类型包 `@amap/amap-jsapi-types`，必须用它。
- 不要把整份评审文档当上下文塞给自己，只按 brief 执行。
