<div align="center">

[English](README.md) · 简体中文

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-trek-light.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/logo-trek-dark.svg" />
  <img src="docs/logo-trek-dark.svg" alt="OhMyTrek" height="96" />
</picture>

<br />
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/subtitle-light.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/subtitle-dark.png" />
  <img src="docs/subtitle-dark.png" alt="your trip. your plan." height="28" />
</picture>

一个自托管的实时协作旅行规划器——内置地图、预算、行李清单、旅行日记与 AI 能力。

> **OhMyTrek 是一个独立项目。**本仓库最初 fork 自
> [liketrek/TREK](https://github.com/liketrek/TREK),如今以自己的名字
> **OhMyTrek** 按独立的路线图持续迭代。当前的重点是面向中国大陆的适配
> (高德地图集成——见 [`docs/amap/`](docs/amap/README.md))。
> 本项目不跟随上游发布,上游引用的预构建 Docker 镜像在此也不提供。

<br />

<img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/iceafish/ohmytrek/test.yml?branch=main&style=for-the-badge">
&nbsp;
<br />
<a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL_v3-6B7280?style=flat-square" /></a>
<a href="https://github.com/iceafish/ohmytrek/releases"><img alt="Latest Release" src="https://img.shields.io/github/v/release/iceafish/ohmytrek?include_prereleases&style=flat-square&color=6B7280" /></a>
<a href="https://github.com/iceafish/ohmytrek"><img alt="Stars" src="https://img.shields.io/github/stars/iceafish/ohmytrek?style=flat-square&color=6B7280" /></a>
</div>

---

<br />

## 你能得到什么

<picture>
  <source media="(max-width: 700px)" srcset="docs/tiles/grid-mobile.svg" />
  <source media="(prefers-color-scheme: dark)" srcset="docs/tiles/grid-desktop-dark.svg" />
  <img src="docs/tiles/grid-desktop.svg" alt="Plan, track, share" width="100%" />
</picture>

<details>
<summary><b>查看全部功能</b></summary>

<br />

以下大部分能力都是管理员可以随时开关的 addon。Lists、Costs、Documents、Collab、Vacay 和 Atlas 默认开启;Journey、Collections、MCP、AI Parsing 和 AirTrail 默认关闭,并在下文中标注。

<table>
<tr>
<td width="50%" valign="top">

#### 🧭 规划

- **每日行程**:在日期之间拖拽地点、在一天内重新排序,支持撤销。笔记和预订同样可以拖拽,地图上的标记点也能直接落到某一天
- **地图**:Leaflet、Mapbox GL 或 MapLibre GL(OpenFreeMap,无需 token),支持聚合、照片标记与路线线段。3D 建筑与地形仅 Mapbox 支持
- **地点搜索**:配置了 key 时使用 Google Places(照片、评分、营业时间),否则使用无需 key 的 OpenStreetMap
- **地点信息增强**:来自 OpenStreetMap、Wikipedia、Wikidata 与 Wikimedia Commons 的描述、常识、营业时间与候选图片
- **POI 探索**:通过 Overpass 按类别拉取当前视野内的 OpenStreetMap POI
- **导入**:共享的 Google Maps 与 Naver Maps 清单,以及 GPX、KML、KMZ 文件
- **导出**:行程地点与轨迹的 GPX,以及按行程或全部行程的 ICS 订阅源
- **路线**:一键优化某天的顺序(先最近邻再 2-opt,锁定的站点和酒店锚点保持不动),支持驾车、步行、骑行profile,基于 OSRM 计算,并可跳转到 Google Maps 或 CoMaps 打开
- **公共交通**:基于 Transitous 的门到门行程
- **天气**:Open-Meteo 的 16 天预报,无需 key。超出该窗口的日期则改为读取历史同期数据
- **每日笔记**:带图标和颜色的 markdown 正文,可拖拽排序或移动到其他日期
- **行程日期**:移动整个行程后各天自动重新计算日期,可以选择带着预订一起移动,或让预订保持锚定。行程还支持复制与归档

</td>
<td width="50%" valign="top">

#### 🧳 预订与账目

- **预订**:16 种预订类型,带状态、确认号、出行人与附件
- **航班与火车**:支持多段航程与经停、每段时间与端点时区,内置 4,045 个机场数据,无需 key 即可正确解析当地时间
- **住宿**:一次入住横跨一段日期范围并带入住时间窗口,覆盖的每一晚都会显示
- **预订导入**:通过 [KItinerary](https://invent.kde.org/pim/kitinerary) 导入 EML、PDF、PKPass、HTML 和 TXT 确认单。需要 `kitinerary-extractor` 二进制,Docker 镜像已内置
- **AirTrail**(默认关闭):连接自托管的 AirTrail 实例,把航班导入为预订并保持同步
- **账单**:以整数分拆分费用,支持均摊或自定义份额、多付款人、结算建议、结算记录,以及 CSV 导出
- **货币**:每笔费用一种货币,汇率在录入时冻结。汇率来自 Frankfurter,无需 key
- **行李清单**:分类、管理员管理的模板、负责人、三级可见性,以及已打包/总数统计。带重量汇总的行李是单独的管理员开关,默认关闭
- **待办**:负责人、截止日期、优先级,以及到期前的提醒
- **文件**:可附加到行程、地点、每日条目或预订。单个 50 MB,视频 500 MB,带回收站与恢复
- **PDF 导出**:封面、地点照片、每日笔记、预订与账单,可按天分页

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 👥 协作

- **实时同步**(WebSocket):对同一行程在线的所有人,编辑即时可见
- **成员**:通过邮箱或用户名添加,可以移交所有权,也可以添加完全无需登录的访客
- **权限**:管理员把 16 种行程操作逐一映射到管理员、行程所有者、行程成员或所有人
- **邀请链接**:每个行程一条可复用的链接,可带过期时间。管理员还能发放有使用次数限制的注册邀请,新账号注册后直接进入对应行程
- **公开分享**:任何人不需账号即可打开的只读行程页面
- **Collab**:带回复、表情回应和链接预览的群聊,带附件的共享笔记、投票,以及即将到来活动的 What's Next 清单。四项能力各自独立开关

#### 📔 日记、Atlas 与 Vacay

- **Journey**(默认关闭):带正文、心情、天气和标签的日记条目,照片与视频可来自上传或关联的 [Immich](https://immich.app) / Synology Photos 图库,支持地图视图、共同作者与公开分享链接
- **Atlas**:在 [geoBoundaries](https://www.geoboundaries.org/) 轮廓上标记到访过的国家和次国家级区域,还有愿望清单、旅行统计与连续旅行年数
- **Vacay**:请假日历,支持半天、来自 date.nager.at 的公共假日、16 个欧洲国家的学校假期叠加、跨年结转,以及计划的共享(共同编辑或只读)
- **Collections**(默认关闭):独立于任何行程的地点收藏库,带标签、评分、自定义地点图片,可复制进行程,也可凭邀请分享

</td>
<td width="50%" valign="top">

#### 🧩 插件

- **第三方插件**:从 TREK registry 安装或侧载 zip,按实例开关,并拥有 `/plugins/<id>` 下的专属页面
- **沙箱隔离**:每个插件一个子进程,63 项可授予的权限,管理员编辑的出站主机白名单,内存与 RPC 上限,以及 AI 与通知调用的每日上限
- **信任**:registry 下载由 sha256 锁定,并对照作者的 minisign key 校验。侧载的 zip 会标记为未验证,`TREK_PLUGINS_ENABLED=false` 可整体关闭该系统
- **扩展点**:地图标记与图层、地点详情、每日日程、PDF 章节、Atlas 图层、日记条目、行程警告、日历源、路线profile与通知渠道。插件页面运行在不透明源的 iframe 中
- **SDK**:npm 上的 [`trek-plugin-sdk`](https://www.npmjs.com/package/trek-plugin-sdk),带 manifest 校验器、mock host,以及用本地构建直连真实数据的开发联调模式

#### 🤖 AI 与 MCP

- **MCP server**(默认关闭):OAuth 2.1,强制 PKCE 与动态客户端注册。199 个工具、30 个资源、4 个 prompt
- **Scopes**:14 组共 29 个 scope,每个都可在授权屏幕上单独勾选。Token 绑定 `/mcp` 资源,每次工具调用都会进入审计日志
- **覆盖面**:创建行程与日期、编辑地点、行李清单、待办、账单、预订、收藏与日记、标记到访国家——全部受 token 所持 scope 约束
- **Prompts**:`trip-summary`,以及在这些 addon 开启时的 `packing-list` 与 `budget-overview`
- **Addon 感知**:七个 addon 开关决定会话能看到哪些工具与资源。切换会使在线会话断开重连,以便重新注册工具面
- **预订提取**(默认关闭):通过本地 Ollama、任意 OpenAI 兼容端点或 Anthropic 读取确认单,支持实例级或用户级配置

</td>
</tr>
<tr>
<td width="50%" valign="top">

#### 📱 移动端与离线

- **可安装**:iOS 和 Android 直接从浏览器安装,无需应用商店。可脱离浏览器边框独立运行,状态栏颜色跟随主题
- **手机布局**:768px 以下使用独立的外壳,带自己的 token、底部栏与安全区内边距。底部栏放哪些入口由用户决定
- **离线读取**:应用外壳与每个路由 chunk 都会预缓存,行程、地点与文件 blob 存放在每用户独立的 IndexedDB 中,因此无网络也能打开行程
- **离线写入**:变更会排队并在重连后重放,携带 `X-Idempotency-Key`,重连不会重复生效。过期冲突的编辑会暂停,等你选择"保留我的"或"保留对方的"
- **离线地图**:预下载行程的栅格瓦片,也可随时清除
- **API 响应绝不被 service worker 缓存**:它们按会话变化,因此始终来自网络

</td>
<td width="50%" valign="top">

#### ⚙️ 管理员、账号与安全

- **登录方式**:密码登录、密码注册、OIDC 登录、OIDC 注册与 passkey 登录各自独立开关。`OIDC_ONLY` 让 SSO 成为唯一入口
- **SSO(OIDC)**:通过 discovery 配置单一 provider,带 PKCE 与 `id_token` 校验(Authentik、Keycloak、Google 等)
- **2FA**:TOTP 加十枚一次性备用码,管理员可全实例强制开启
- **Passkeys**:基于 WebAuthn 的指纹、面容、PIN 或安全密钥登录,默认关闭直到管理员启用。passkey 同时可满足 2FA 要求
- **加固**:登录、密码重置与 2FA 尝试的按 IP 限制,密码策略,静态加密、读取脱敏的机密,以及所有可配置 URL 上的 SSRF 防护
- **管理面板**:用户与邀请、权限矩阵、行李模板、分类、addon、插件、API key、MCP token 与 OAuth 会话、备份、存储、审计日志,以及 GitHub releases
- **备份**:手动或按小时/天/周/月定时,按天数保留。zip 会携带静态加密 key,恢复时可以解密自己的机密
- **存储**:按内容类别可插拔的存储后端——全部留在本地磁盘,或添加 S3 兼容后端并把任意类别复制过去,完全在管理面板中配置
- **通知**:按用户的事件矩阵,覆盖站内信、邮件(SMTP)、webhook 与 ntfy,外加插件注册的任意渠道
- **外观**:浅色、深色或跟随系统,七套配色加自定义强调色,透明度、紧凑密度、减弱动效,以及分级字号
- **23 种语言**:en、de、es、fr、it、nl、hu、ru、zh、zh-TW、pl、cs、ar(从右到左)、br、id、tr、ja、ko、uk、gr、sv、vi、ca
- **站内帮助**:wiki 随镜像打包并从磁盘在 `/help` 提供,文档与你运行的版本保持一致

</td>
</tr>
</table>

</details>

<br />

<div align="center">
  <a href="docs/screenshots/showcase-desktop-1.webp"><img src="docs/screenshots/showcase-desktop-1.webp" alt="Atlas · dashboard · trip planner" width="100%" /></a>
  <a href="docs/screenshots/showcase-mobile.webp"><img src="docs/screenshots/showcase-mobile.webp" alt="Mobile PWA · dashboard, day plan, map, costs" width="100%" /></a>
  <a href="docs/screenshots/showcase-desktop-2.webp"><img src="docs/screenshots/showcase-desktop-2.webp" alt="Collections · journey journal · costs" width="100%" /></a>
</div>

<br />

## AI 使用说明

我们在本代码库的部分开发中使用了 LLM 辅助编码工具。凡未经维护者阅读并理解的内容都不会发布:每一处改动都经过评审与测试,并且有一位可以为此负责的人。"是 AI 写的"不是我们任何人会接受的解释。

<br />

## 30 秒上手

本 fork 不发布 Docker 镜像——请从源码运行,或使用仓库中的
[`Dockerfile`](Dockerfile) 自行构建镜像:

```bash
git clone https://github.com/iceafish/ohmytrek && cd ohmytrek
corepack enable && pnpm install
pnpm run dev
```

打开 `http://localhost:5173`(Vite 开发服务器会把 API 代理到
`:3001` 的后端)。首次启动时 OhMyTrek 会创建一个管理员账号——设置
`ADMIN_EMAIL`/`ADMIN_PASSWORD`(见 `server/.env.example`),或从服务器日志中读取凭据。

<div align="center">

<a href="#docker-compose-production">Docker Compose</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#helm-kubernetes">Helm / Kubernetes</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#install-as-app-pwa">以 PWA 安装</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="#reverse-proxy">反向代理</a>

</div>

<br />

## 技术栈

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22-339933?style=flat-square&logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS_11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

通过 WebSocket(`ws`)实现实时同步。后端基于 NestJS 11,状态管理使用 Zustand,认证涵盖 JWT + OAuth 2.1 + OIDC + Passkeys(WebAuthn)+ TOTP MFA。天气数据来自 Open-Meteo(无需 key),地图使用 Leaflet 与 Mapbox GL。

<br />

<h2 id="docker-compose-production">Docker Compose(生产环境)</h2>

仓库附带开箱即用的 [`docker-compose.yml`](docker-compose.yml),
默认配置安全且每个选项都有内联说明;它会从本仓库构建镜像,然后:

```bash
docker compose up -d --build
```

完整步骤见 [Install with Docker Compose](https://github.com/iceafish/ohmytrek/blob/main/wiki/Install-Docker-Compose.md)。

<br />

<h2 id="helm-kubernetes">Helm(Kubernetes)</h2>

直接从本仓库中的 chart 安装:

```bash
helm install trek ./charts/trek
```

各项取值见 [`charts/README.md`](charts/README.md)。

<br />

<h2 id="install-as-app-pwa">以应用形式安装(PWA)</h2>

OhMyTrek 可以作为 Progressive Web App 运行——无需应用商店。

1. 在浏览器中打开 OhMyTrek(需要 HTTPS)
2. **iOS**:分享 ▸ *添加到主屏幕*
3. **Android**:菜单 ▸ *安装应用*(或 *添加到主屏幕*)

OhMyTrek 随后会以全屏、带自有图标的方式启动,与原生应用无异。

<br />

## 更新

见 [Updating](https://github.com/iceafish/ohmytrek/blob/main/wiki/Updating.md)——
覆盖 Docker Compose、Docker run、Helm、Portainer、Unraid 与 Proxmox,
以及加密 key 的注意事项。

<br />

<h2 id="reverse-proxy">反向代理</h2>

生产环境中,请将 OhMyTrek 放在终结 TLS 的反向代理之后。OhMyTrek 使用 WebSocket 做实时同步,因此代理**必须**支持 `/ws` 上的 WebSocket 升级。

如果使用 MCP addon,代理还必须在 `/mcp` 上双向透传 `Mcp-Session-Id` 请求头——Nginx 和 Caddy 默认会透传,但会剥离该头的代理会让每次工具调用都新建会话而不是复用。详见 [Reverse Proxy wiki 页面](https://github.com/iceafish/ohmytrek/blob/main/wiki/Reverse-Proxy.md)。

<details>
<summary>Nginx</summary>

```nginx
server {
    listen 80;
    server_name ohmytrek.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ohmytrek.yourdomain.com;

    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;

    # 500 MB covers backup-restore uploads (capped at 500 MB server-side).
    client_max_body_size 500m;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Only needed if you use the MCP addon. Responses are Server-Sent Events,
    # so buffering must be off or tool results arrive late.
    location /mcp {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

</details>

<details>
<summary>Caddy</summary>

```caddy
ohmytrek.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy 会自动处理 TLS 与 WebSocket。

</details>

<br />

## 环境变量

每个变量、默认值与作用说明见
[Environment Variables](https://github.com/iceafish/ohmytrek/blob/main/wiki/Environment-Variables.md)。

## 数据来源

Atlas 地图的国家与次国家级(省/县)边界来自
[**geoBoundaries**](https://www.geoboundaries.org/)(Runfola et al., 2020),遵循
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可。完整的第三方署名见 [NOTICE.md](NOTICE.md)。

<br />

## 许可证

OhMyTrek 基于 [AGPL v3](LICENSE)。个人或公司内部自托管完全自由。如果你修改后把 OhMyTrek 作为网络服务提供给第三方,你的修改必须以同一许可证开源。
