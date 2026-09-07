# 高德地图接入 — 施工包

本目录是把「TREK 接入高德地图」这件事拆成的可独立交付的工作包，每份 brief 直接面向执行的
coding agent 或工程师。

**背景与论证不在这里。** 方案为什么这么选、坐标基线怎么测出来的、哪些功能会降级，见评审文档
《TREK 地图层与高德接入》。那份文档给人读，本目录给执行者用 —— 不要把整份评估文档丢给 agent
当上下文，它绝大部分是决策论证，会稀释掉真正的约束。

## 已定型的前提

| 项 | 结论 |
|---|---|
| 范围 | 本轮仅针对**中国大陆行程**做本地化适配，与用户所在地无关 |
| 方案 | 高德作为**第四个 provider** 接入，设为默认值；**不删除**现有 Leaflet / Mapbox / MapLibre（2026-09-08 拍板，边界已封闭，不再讨论） |
| 坐标 | 数据库保持 WGS84 唯一真值，GCJ-02 只存在于渲染边界 |
| 离线 | 高德模式下瓦片预取**硬关闭**（服务条款禁止缓存/存储/抓取） |
| 富化 / 公交 | OSM / Wikimedia / Transitous 链路**保留不动**，与底图 provider 正交 |

## 官方 skill

本仓库已安装高德官方 skill 到 `.claude/skills/amap-jsapi-skill/`，随仓库提交。
**所有涉及高德 API 的实现都必须依据它落地**，详见 [00-constraints.md](00-constraints.md)。

来源：<https://github.com/AMap-Web/amap-skills>（MIT）。上游为 Cursor 设计、装在
`.cursor/skills/`；其 `SKILL.md` + `references/` 格式与 Claude Code 一致，故直接置于
`.claude/skills/`。升级时重新拉取上游覆盖该目录即可。

## 施工顺序

```
01 坐标层  ──┬──> 02a 渲染器·基础 ──> 02b 渲染器·叠加层 ──┬──> 05 降级面处置
             │                                              │
             └──> 03 服务端 provider ──> 04 路径规划服务端化 ─┘
```

| 包 | 文件 | 前置 | 需要凭据 |
|---|---|---|---|
| 01 坐标层 | [01-coordinate-layer.md](01-coordinate-layer.md) | 无 | 不需要 |
| 02a 渲染器·基础 | [02a-renderer-base.md](02a-renderer-base.md) | 01 | Web端 key + securityJsCode |
| 02b 渲染器·叠加层 | [02b-renderer-overlays.md](02b-renderer-overlays.md) | 02a | 同上 |
| 03 服务端 provider | [03-server-provider.md](03-server-provider.md) | 01 | Web服务 key |
| 04 路径规划服务端化 | [04-routing.md](04-routing.md) | 03 | Web服务 key |
| 05 降级面处置 | [05-degraded-surfaces.md](05-degraded-surfaces.md) | 02b | — |

`01` 是所有工作的地基，且是唯一一个做错了会**静默污染全系统**的部分（天气、时区、Atlas 国界
判定都读同一组 lat/lng）。它必须单独先做、先测、先合入。`02` 与 `03` 在 `01` 合入后可并行。

## 派活方法

1. **每次只派一个包。** 整体是 9–12 周的工作量，一次性丢过去 agent 会开始自行发明架构决策，
   而那些决策已经定了。
2. **每个包开工前先让 agent 读 [00-constraints.md](00-constraints.md)**，那是所有包共用的仓库
   约束与禁令。各包 brief 里只写该包特有的部分。
3. **验收看 brief 末尾的命令清单**，不看 agent 的自述。

## 凭据

高德的 key 按**服务平台**绑定，互不通用。本项目需要三个：

| 凭据 | 用途 | 能否到达浏览器 |
|---|---|---|
| Web端 JS API key | 浏览器加载地图 | 可以（本就设计为前端公开，配域名白名单） |
| securityJsCode 安全密钥 | 与上者配对鉴权 | **绝不** —— 必须经服务端代理注入 |
| Web服务 key | 服务端检索 / 路径规划 / 坐标转换 | **绝不** —— 只在服务端 |
