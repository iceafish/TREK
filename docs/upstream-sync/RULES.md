# 上游跟随规则（Upstream Sync Rules）— Agent 操作规范

本文件是 **coding agent 必须遵循的操作规则**，不是背景介绍。凡涉及下列任一场景，
按本文件执行；与本文件冲突的一般性建议一律让位于本文件：

- 从上游（liketrek/TREK 经由 `origin/main`）吸收提交；
- 修改与上游共享的文件（含 `package.json`、`shared/src/i18n/**`、文档、CI）；
- 在 `server/src/mcp/**`、`server/src/nest-mcp/**` 等"零占用区"附近工作；
- 新增任何 fork 定制代码。

硬规则违反 = 任务失败，即使产出功能正常。

---

## 0. 模型不变量（Invariants）

本仓库 = `origin/main`（上游镜像）+ `dev`（补丁栈，patch stack）。

| # | 不变量 | 验证命令 |
|---|--------|----------|
| I1 | `main` 是上游的**只读镜像**，任何情况下不在 main 上产生提交 | `git log origin/main..main` 必须为空 |
| I2 | `dev` = origin/main + **线性补丁栈**，零 merge commit；吸收上游只用 rebase | `git rev-list --count --merges origin/main..dev` 必须为 0 |
| I3 | fork 的全部定制 ≡ `git diff origin/main...dev`（三点 diff）。任何破坏该恒等式的操作（merge 上游进 dev、在 main 提交）禁止 | 同步后抽核：diff 中不应出现无法归因到 fork 提交的内容 |
| I4 | `origin/dev` 落后本地 dev 是常态；推送只允许 `--force-with-lease`（rebase 重写历史） | `git push --force-with-lease origin dev` |

推论：判断"某改动是不是 fork 的"永远问 `git diff origin/main...dev`，不凭记忆。

---

## 1. 补丁形状纪律（Patch Shape）

同步成本由补丁的**形状**决定，不由 git 技巧决定。新增补丁时按以下优先级选择形态：

**S1 additive 优先**：新功能放新文件/新模块（如 `server/src/nest/<新域>/`、`client/src/components/`新组件、`docs/`），零冲突且永不过闸。AMap 五包即此形态。

**S2 必须 in-place 时，收窄成 seam**：把对上游文件的修改压到一个显式分支点
（provider 接口 / config 字段 / DI 注册 / 一处 `if (provider === 'amap')`），
禁止大面积重写上游文件主体。一个补丁触达的上游文件数与行数越小越好。

**S3 预算指标**：每次同步后检查 `git diff origin/main...dev --stat` 中**上游路径**的改动量，
应保持小而稳定。持续膨胀 = 定制正在渗入上游领地，需要重构回 seam/additive。

**S4 零占用区（zero-occupation zones）**——永不直接编辑：

- `server/src/mcp/**`、`server/src/nest-mcp/**`、`MCP.md`

  MCP 相关需求只能走上游已有扩展点：`tools/` 注册层、scopes、addons 开关
  （`server/src/addons.ts`），或新建独立 nest 模块。
  理由：fork 对 MCP 深度依赖上游迭代，上游 MCP 变更必须能零冲突流入。

**S5 文档所有权**——以下文件为 fork 所有，冲突时**恒取 fork 侧**，不吸收上游版本：

- `CLAUDE.md`、`client/CLAUDE.md`、`server/CLAUDE.md`、`shared/CLAUDE.md`、`plugin-sdk/CLAUDE.md`
- `AGENTS.md`、`CONTRIBUTING.md`、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/ISSUE_TEMPLATE/**`
- `docs/**`、`wiki/` 中 fork 新增/重写的页面

**S6 i18n**：只**追加** fork 新 key（如 `settings.mapAmapOfflineHint`），不改动上游既有 key 的
结构与取值；fork 新 key 一次补齐全部 23 个 locale 目录，`i18n:parity:strict` 是硬门。

**S7 lockfile**：本仓库 pnpm-only（`packageManager: pnpm@10.34.5` + `pnpm-workspace.yaml`）。
`package-lock.json` 恒为删除态；上游对 `package.json` 的变更按 §4 决策表合并后
`pnpm install` 重算 `pnpm-lock.yaml`。root `optionalDependencies` 的 musl binary pins
必须与 client 的 `sharp` / `rollup` 版本保持 lockstep（Alpine 镜像依赖它）。
注意：`pnpm import` 是坏的（pnpm#6233），**不要**用它；增量吸收直接 `pnpm install`，
只有从零重建 lockfile 才需要 override-bootstrap 配方。

---

## 2. 同步 SOP（Upstream Absorption Runbook）

前提：上游已在 GitHub 侧完成 Sync fork（`origin/main` 已更新）。本机无 `upstream` remote，
上游变更只通过 `origin/main` 进入。

### 步骤 0 — 预检与预演

```bash
git status --porcelain                 # 必须为空；脏树先处理（stash 或先提交）
git fetch origin --prune
git branch backup/pre-sync-$(date +%F) dev        # 备份分支，必建
git config rerere.enabled true                    # 已配置；确认未被关闭
git merge-tree --write-tree --name-only dev origin/main > /tmp/bill.txt; echo "exit=$?"
```

`merge-tree` 输出即本次同步的**冲突账单**（exit 1 = 有冲突）。先看账再动手：
账单里每个文件都应能归入 §4 决策表的一行。出现表外类别 → §7 停机条件。

同时记录本次规模，写进最终报告：

```bash
git rev-list --count dev..origin/main          # 上游新增提交数
git diff --name-only $(git merge-base dev origin/main) origin/main | wc -l   # 上游改动的文件数
```

### 步骤 1 — 重放

```bash
GIT_EDITOR=true git rebase origin/main
```

### 步骤 2 — 解冲突（每次停靠）

> ⚠️ **ours/theirs 在 rebase 中是反的**：`--ours` = 已 rebase 到的基底（含上游），
> `--theirs` = 正在重放的 fork 提交。**永远用内容验证侧别，不信任记忆**：
> `git show <冲突提交hash>:<file> | head` 对比工作区，或对 fork 侧文件 grep
> fork 标识（`ohmytrek` / `iceafish` / `高德` / `amap`）。

按 §4 决策表逐文件处置 → `git add` / `git rm` → `GIT_EDITOR=true git rebase --continue`。
循环直到完成。首次解决会被 rerere 记录，后续同步同型冲突自动复用。

### 步骤 3 — 语义修复（自动合并 ≠ 语义正确）

重放完成后，对所有"两侧都改过且自动合并"的文件做语义检查，重点：

- 上游**重构了结构**（如抽 hook、改返回值、改签名）而 fork 补丁基于旧结构时：
  **取上游新结构，把 fork 的行为意图移植进新结构**。绝不能用 fork 的旧文件整体覆盖。
  （案例：2026-09 上游把 `OfflineTab` 抽成 `useOfflineSettings` hook，fork 的 amap
  提示以 3 处小改移植进新 markup，而非取 fork 侧整文件。）
- 上游**变更行为契约**（返回值、事件名、默认值）导致 fork 测试红：先判断 fork 的
  **行为闸门**是否仍有效——闸门有效则只改断言适配新契约；闸门失效则修闸门，
  且该修复必须是独立 `fix`/`test` 提交，写明上游引入变更的提交 hash。
  （案例：上游 `1b71b863` 把 `prepareForOffline` 返回值从 number 改为
  `{status, trips}`，fork 的 amap 跳过闸门不变，仅 `FE-SYNC-PREP-023` 断言适配。）

### 步骤 4 — lockfile 重算

```bash
pnpm install                                # 吸收上游依赖清单变更
# 检查 client 的 sharp / rollup 版本是否变化；变了则同步 root optionalDependencies 的 musl pins
grep -E '"(sharp|rollup)"' client/package.json
```

lockfile 重算作为独立 `chore(deps)` 提交落在栈顶（不 fixup 进栈底，保持每一步可读）。

### 步骤 5 — 验证 gates

全部通过才算同步完成，见 §5。

### 步骤 6 — 推送与记录

```bash
git push --force-with-lease origin dev
git branch -d backup/pre-sync-$(date +%F)    # 可选：确认无事后清理备份
```

**收尾义务**：把本次基线变化写回 §5（新增/消失的已知失败、新的上游破坏契约案例），
并在提交信息中注明吸收的上游版本区间（如 `4.1.1 → 4.2.1`）。

---

## 3. 冲突决策表

rebase 停靠时，逐文件对号入座。"fork 侧"= 正在重放的提交（rebase 语义的 `--theirs`）。

| 文件类别 | 处置 | 说明 |
|---|---|---|
| `CLAUDE.md` ×5、`AGENTS.md`、`CONTRIBUTING.md`、`.github/**` 模板 | 取 fork 侧 | S5 所有权；机械解决，rerere 会记住 |
| `package-lock.json`（任何子包） | `git rm` | pnpm-only；上游还在维护 npm lockfile，**每次同步必撞**，属预期 |
| 根/子包 `package.json` | 手工合并 | 取上游的依赖版本与新增项；保留 fork 的 `packageManager`、`preinstall` 守卫、`pnpm.overrides`、musl pins、pnpm 风格 scripts；完成 后 `pnpm install` |
| `pnpm-lock.yaml`、`pnpm-workspace.yaml` | 不会冲突 | fork 独有文件；但重算义务见步骤 4 |
| `shared/src/i18n/**` | 双方都留 | 上游改既有 key / fork 追加 key，多数自动合并；撞行时手工保留双方 |
| `shared/src/<domain>/*.schema.ts` | 手工合并 | 契约层是单一事实源：上游字段一字不动，fork 追加字段可空可选 |
| 文档被 fork 重写 + 上游也改了（非 S5 清单） | 逐文件判断 | fork 重写意图优先；上游新增的纯增量信息（新命令、新 env）合并进来 |
| 代码文件（自动合并失败） | 行为意图移植 | 见步骤 3；默认取上游结构 |
| 上游**删除**了 fork 修改过的文件 | **停机**（§7） | 需要人判断 fork 功能是否随之废弃 |

---

## 4. 验证 Gates 与已知基线

| Gate | 命令 | 通过标准 |
|---|---|---|
| Build | `pnpm run build` | 三包构建成功 |
| Typecheck ×3 | `pnpm --filter @trek/shared\|@trek/server\|@trek/client run typecheck` | tsc 零错误 |
| i18n parity | `pnpm --filter @trek/shared run i18n:parity:strict` | File/Key parity OK |
| Server unit | `pnpm --filter @trek/server run test:unit` | 失败集合 ≡ 基线 A |
| Client unit | `cd client && pnpm run test` | 失败集合 ≡ 基线 B |
| Lint | `pnpm run lint` | 0 errors；warnings 不超过基线 C |

**基线 A**（server unit，2026-09-11 @ upstream 4.2.1）：`discovery.test.ts` ×3 +
`validate-body-contracts.test.ts` GATE-001/GATE-004，共 5 失败。另有 flaky 集：
AUTH-004/018（限流时序）、atlas/memories 外网超时类——重跑即过的不算失败。

**基线 B**（client unit，2026-09-11 @ upstream 4.2.1）：`AdminPage FE-PAGE-ADMIN-019`
（invite token 超时）。**已判定为上游 4.2.1 自身问题**：该测试与其被测代码在
4.1.1→4.2.1 窗口零改动，同一测试在 4.1.1 基座通过、在 4.2.1 基座失败，fork 未触及
admin/invite 路径。上游修复前每次同步都会见到，不作为 fork 回归处理。
全量跑偶发 `FE-PAGE-ADMIN-019` 之外的 singles 失败 → 先单文件重跑再定性。

**基线 C**（lint warnings）：client ≈1400 / server ≈340。只怀疑**增长**。

**e2e**（Playwright）不在同步 gates 内：机器基线即 5F/5P（历史遗留），仅当同步涉及
对应功能域时按需跑功能子集 `--project=public --project=setup --project=seed --project=app`。

**基线维护规则**：基线只能由"同步 SOP 步骤 6"更新；更新必须附双侧证据
（旧基座跑过 + 新基座跑过 + 归因到具体上游提交）。禁止为了让 gate 变绿而修改基线。

---

## 5. 节奏与自动化

**G1 release 节拍**：上游以 `github-actions[bot]` 的 `chore: bump version to X.Y.Z` 提交
标记版本。跟随粒度 = 上游 **minor/patch release**，不追单个提交。执行时机自定，
但两次同步间隔内**不**做与上游强耦合的大重构（避免账单叠加）。

**G2 热修复例外**：需要上游某个具体修复而不等 release 时，`git cherry-pick <hash>` 进 dev。
rebase 时 patch-id 相同的 cherry-pick 会被自动去重，不会留残渣。cherry-pick 提交信息
保留上游原信息（不 squash、不改写），便于去重与溯源。

**G3 动手前先看账**：任何同步以 `git merge-tree` 账单开始（步骤 0）。账单是决策依据，
不是形式——账单里出现表外文件类别即触发 §7。

**G4 可选护栏**：fork 自带 GitHub Actions 权限，可加 scheduled workflow 每周对比
`origin/main` 与 dev 的领先量、超阈值开 issue。本机无 gh token，不依赖本机自动化。

---

## 6. 停机条件（Stop and Ask）

遇到以下任一情况，**停止操作、报告用户、给出选项**，不得自行决断：

1. 冲突文件无法归入 §3 决策表任何一行；
2. 上游删除或重命名了 fork 修改过的文件（delete/modify 反向冲突）；
3. 某 gate 失败且不在 §4 基线内；
4. fork 补丁的**行为意图**与上游新行为根本冲突（需要产品决策取舍，而非技术移植）；
5. `merge-tree` 账单冲突文件 > 15（先和用户确认是否分期吸收）。

---

## 7. 快速卡片（Cheat Sheet）

```bash
# ---- 一次性环境（已配好，勿动）----
git config rerere.enabled true
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'

# ---- 同步 ----
git fetch origin --prune
git branch backup/pre-sync-$(date +%F) dev
git merge-tree --write-tree --name-only dev origin/main   # 看账单
GIT_EDITOR=true git rebase origin/main                    # 按决策表解冲突，循环
pnpm install                                              # lockfile 重算
pnpm run build && pnpm --filter @trek/shared run typecheck \
  && pnpm --filter @trek/server run typecheck && pnpm --filter @trek/client run typecheck
pnpm --filter @trek/shared run i18n:parity:strict
pnpm --filter @trek/server run test:unit                  # 对照基线 A
cd client && pnpm run test && cd ..                       # 对照基线 B
git push --force-with-lease origin dev
# 收尾：更新本文件 §4 基线 + 报告
```

---

## 8. 决策记录

- **2026-09-11 首次补丁栈 rebase（4.1.1 → 4.2.1）**：吸收上游 2241 提交 / 705 文件；
  fork 23 提交重放，2 处冲突停靠（栈底 mega-commit `ecb124fa`：CLAUDE.md ×5 +
  package.json + package-lock.json；05 包 `096f4a07`：OfflineTab.tsx hook 化移植），
  其余 21 提交零冲突。语义修复 1 处（FE-SYNC-PREP-023 契约适配，见步骤 3 案例）。
  另确认：上游在 `OfflineTab` 等 120+ 重叠文件上与 fork 自动合并成功，语义正确性由
  §4 gates 验证。本文档即该次同步的产物之一。
