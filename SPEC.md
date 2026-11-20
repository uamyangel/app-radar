# App Store 洞察看板 — 项目说明（SPEC）

> 给 Claude Code 的工作方式：
> 1. 先完整读完本文档再动手。
> 2. 严格按「里程碑」顺序推进，**每完成一个里程碑停下来，给出验收方式，等我确认后再继续**。
> 3. 文档里标注「需验证」的接口和参数，先写脚本实测，结果和文档不一致时以实测为准，并告诉我差异。
> 4. 所有密钥只从环境变量读取，绝不写进代码或提交到仓库。
> 5. **决策边界见第 13 节**：「固定约定」不能自行更改，需要改的话先问我；「由你决定」的事项按实际情况择优选择，每个决定在 `DECISIONS.md` 里记一行（选了什么、为什么）。

---

## 1. 背景与目标

个人自用工具。每天自动从 Apple App Store 的**免费公开接口**抓取榜单、App 信息和评论，用大模型做翻译和总结，在一个网页上浏览。

目的：发现需求信号和产品机会，比如哪些品类在变热、用户在抱怨什么、哪些产品"评分低但排名高"（需求强、产品弱）。

**体验原则：最小操作。**所有翻译、摘要、简报都在后台提前生成好并存储，打开网页时只做查询和展示，不现场调用大模型。

## 2. 范围

### 2.1 国家/地区

| 代码 | 名称 | 是否需要翻译 |
|---|---|---|
| `us` | 美国 | 是 |
| `cn` | 中国 | 否（中文评论跳过翻译；少量非中文评论照常翻译） |
| `jp` | 日本 | 是 |

### 2.2 品类（20 个）

Genre ID 需在 M0 验证。

**核心（12 个）**

| 中文 | English | Genre ID |
|---|---|---|
| 效率 | Productivity | 6007 |
| 商务 | Business | 6000 |
| 教育 | Education | 6017 |
| 健康健美 | Health & Fitness | 6013 |
| 医疗 | Medical | 6020 |
| 财务 | Finance | 6015 |
| 工具 | Utilities | 6002 |
| 图形和设计 | Graphics & Design | 6027 |
| 摄影与录像 | Photo & Video | 6008 |
| 生活 | Lifestyle | 6012 |
| 开发者工具 | Developer Tools | 6026 |
| 参考资料 | Reference | 6006 |

**次要（8 个）**

| 中文 | English | Genre ID |
|---|---|---|
| 美食佳饮 | Food & Drink | 6023 |
| 旅游 | Travel | 6003 |
| 购物 | Shopping | 6024 |
| 社交 | Social Networking | 6005 |
| 新闻 | News | 6009 |
| 图书 | Books | 6018 |
| 音乐 | Music | 6011 |
| 娱乐 | Entertainment | 6016 |

另外保留一个「全部」（不分品类的总榜）。

### 2.3 榜单

- 免费榜（top free）
- 付费榜（top paid）
- 畅销榜（top grossing）

每个榜单抓前 100 名。

### 2.4 非目标（本期不做）

游戏品类、Google Play、多用户、实时数据、付费数据源。

## 3. 数据源（Apple 免费公开接口）

> ⚠️ 下面的端点都**需要在 M0 实测验证**。Apple 会不定期调整这些接口。

### 3.1 榜单

**A. 旧版 iTunes RSS（支持品类筛选和畅销榜，主力）**

```
https://itunes.apple.com/{cc}/rss/topfreeapplications/limit=100/genre={genreId}/json
https://itunes.apple.com/{cc}/rss/toppaidapplications/limit=100/genre={genreId}/json
https://itunes.apple.com/{cc}/rss/topgrossingapplications/limit=100/genre={genreId}/json
```

总榜去掉 `genre=` 段即可。

注意：这个旧版接口的 robots.txt 不允许自动化访问。本项目是个人低频使用（每天一次），但要做到：
- 请求间隔 ≥ 1 秒，失败时指数退避重试；
- 设置合理的 User-Agent；
- 如果接口失效，降级到下面的新版接口（只能拿总榜的免费榜和付费榜），并在任务日志中明确记录。

**B. 新版 Marketing Tools RSS（降级备用）**

```
https://rss.marketingtools.apple.com/api/v2/{cc}/apps/top-free/100/apps.json
https://rss.marketingtools.apple.com/api/v2/{cc}/apps/top-paid/100/apps.json
```

只有总榜的免费榜和付费榜：不支持品类筛选，也没有畅销榜。

### 3.2 App 详情

```
https://itunes.apple.com/lookup?id={id1,id2,...}&country={cc}
```

支持用逗号分隔批量查询。单次批量上限需要验证，先按 ≤ 100 个处理。

需要的字段：名称、开发者、开发者 ID、品类、价格、币种、平均评分、评分数、当前版本、首发日期、当前版本发布日期、更新说明、描述、图标、商店链接、内购信息（如有）。

### 3.3 评论

```
https://itunes.apple.com/{cc}/rss/customerreviews/page={1..10}/id={appId}/sortby=mostrecent/json
```

- 每页约 50 条，最多 10 页，也就是每个 App 在每个国家/地区最多约 500 条最新评论。
- 字段：评论 ID、评分、标题、内容、作者、版本、时间、有用数（如有）。
- 第一页的结构可能包含 App 自身信息，解析时要注意区分。

## 4. 架构

```
GitHub Actions（私有仓库，每天定时）
  └─ TypeScript 采集管道（Node 22）
       ├─ 抓榜单 → 抓详情 → 抓评论
       ├─ DeepSeek：翻译（每天）+ 摘要/简报（每周）
       └─ 写入 Railway Postgres
                     ↑
Cloudflare Pages（前端） + Pages Functions（只读 API）
  └─ 通过 Hyperdrive（或 TCP 直连）查询 Railway Postgres
  └─ 用 Cloudflare Access 加登录保护，只允许我自己访问
```

### 技术栈（固定：全部使用 TypeScript）

- **语言与运行时**：全部使用 TypeScript（strict 模式）。采集管道跑在 Node.js 22 LTS 上，接口跑在 Cloudflare Pages Functions 上。
- **包管理**：pnpm workspaces（monorepo）。
- **前端**：Vite + React + Tailwind。保持简单，不引入状态管理框架。
- **数据库访问**：表结构只在 `packages/shared` 里定义一次，采集端和接口端共用。默认用 Drizzle ORM + postgres.js（它同时支持 Node 和 Workers/Hyperdrive）；如果实测有问题可以换，但要记入 `DECISIONS.md`。
- **校验**：所有外部输入（Apple 接口返回、DeepSeek 返回、配置文件、API 参数）都用 zod 校验。

### 目录结构（固定顶层，内部由你组织）

```
/packages/shared    数据库表结构、类型、zod schema、配置加载、常量（品类表等）
/apps/pipeline      采集与 AI 处理（Node CLI）
/apps/web           前端（Vite）+ /functions（Pages Functions API）
/scripts            M0 验证脚本、运维脚本
/drizzle            数据库迁移文件
config.yaml
DECISIONS.md
.github/workflows/daily.yml
```

## 5. 数据模型（Postgres）

下面的 SQL 用来说明**语义和核心字段**（固定约定）。实际代码在 `packages/shared` 里用 Drizzle 定义；具体的列类型、可选字段和索引由你根据实测数据决定。

```sql
-- App 信息（按国家/地区区分，因为价格、评分、名称可能不同）
apps (
  app_id        bigint,
  country       text,
  name          text,
  developer     text,
  developer_id  bigint,
  primary_genre_id int,
  genre_ids     int[],
  price         numeric,
  currency      text,
  rating_avg    numeric,
  rating_count  int,
  version       text,
  release_date  timestamptz,
  version_date  timestamptz,
  release_notes text,
  description   text,
  icon_url      text,
  store_url     text,
  first_seen    date,
  updated_at    timestamptz,
  PRIMARY KEY (app_id, country)
)

-- 榜单快照：一行 = 某天某国家某品类某榜单的完整前 100（压缩存储）
chart_snapshots (
  snapshot_date date,
  country       text,
  genre_id      int,      -- 0 表示总榜
  chart_type    text,     -- free / paid / grossing
  app_ids       bigint[], -- 按排名顺序
  source        text,     -- legacy / marketing（记录用了哪个接口）
  PRIMARY KEY (snapshot_date, country, genre_id, chart_type)
)

-- 每日评分快照（用于评分趋势）
app_rating_daily (
  app_id bigint, country text, snapshot_date date,
  rating_avg numeric, rating_count int,
  PRIMARY KEY (app_id, country, snapshot_date)
)

-- 评论
reviews (
  review_id     text PRIMARY KEY,
  app_id        bigint,
  country       text,
  rating        smallint,
  title         text,
  content       text,
  author        text,
  app_version   text,
  reviewed_at   timestamptz,
  lang          text,      -- 检测出的语言
  title_zh      text,      -- 中文译文；中文原文时为空
  content_zh    text,
  translated_at timestamptz,
  fetched_at    timestamptz
)
-- 索引：(app_id, country, reviewed_at desc)、(country, rating)

-- App 周度 AI 摘要
app_summaries (
  app_id bigint, country text, week_start date,
  summary jsonb, model text, created_at timestamptz,
  PRIMARY KEY (app_id, country, week_start)
)

-- 品类周度 AI 简报
category_briefs (
  country text, genre_id int, week_start date,
  brief jsonb, model text, created_at timestamptz,
  PRIMARY KEY (country, genre_id, week_start)
)

-- 任务运行日志
job_runs (
  id bigserial PRIMARY KEY, started_at timestamptz, finished_at timestamptz,
  stage text, status text, stats jsonb, errors jsonb
)
```

**排名计算**：用 `array_position(app_ids, app_id)` 从快照里算出某个 App 的排名和历史走势，不需要单独的排名表。

## 6. 采集管道

### 6.1 每日任务（按顺序执行，每一步都要幂等）

1. **榜单**：3 个国家/地区 × 21（20 个品类 + 总榜）× 3 个榜单，写入 `chart_snapshots`。
2. **App 详情**：对当天所有出现在榜单里的 App 批量调用 lookup，更新 `apps`，并写入 `app_rating_daily`。
3. **评论**：只抓每个榜单**前 50 名**的 App（去重后），每个 App 每天抓第 1 页（最新 50 条），按 `review_id` 去重入库。
   - App 第一次进入评论采集范围时，回填最多 N 页（可配置，默认 3 页）。
4. **翻译**：对 `lang != zh` 且未翻译的评论批量翻译（详见第 7 节）。
5. **每周一额外执行**：生成 App 摘要和品类简报。

### 6.2 工程要求

- 请求按主机限速（默认每秒 ≤ 1 个请求，可配置），使用指数退避重试，单个条目失败不影响整体任务。
- 每个阶段写入 `job_runs`：开始/结束时间、请求数、成功/失败数、新增评论数、翻译条数、token 用量和估算费用。
- 支持命令行单独运行某个阶段，以及只跑指定的国家/地区和品类，方便本地调试，例如：
  `pnpm pipeline run --stage charts --country us --genre 6007`
- 支持 `--dry-run`（不写库，只打印）。

### 6.3 定时

GitHub Actions 每天北京时间凌晨运行一次（cron 用 UTC 表示，分钟数不要用 0，避开整点高峰），同时支持手动触发（`workflow_dispatch`）。运行环境：Node 22 + pnpm，启用依赖缓存。

## 7. 大模型处理（DeepSeek）

- DeepSeek 的 API 与 OpenAI 兼容，`base_url` 为 `https://api.deepseek.com`。**模型名称以官方文档为准，在 M3 开始前核对一遍**。
- 统一封装成一个 LLM 客户端：自动重试、JSON 输出校验（校验失败时重试一次再跳过）、token 计数。
- **每日预算上限**（配置项）：累计估算费用达到上限后停止调用大模型，剩余工作留到第二天，并写入日志。

### 7.1 评论翻译（每日）

- 语言检测（本地规则，不调用大模型）：
  - 含日文假名（平假名或片假名）→ 判为日文，需要翻译；
  - 以汉字为主且不含假名 → 判为中文，跳过翻译（繁体中文也跳过，不转简体）；
  - 其余情况（英文等）→ 需要翻译；
  - 判断不了的（例如只有 emoji 或极短文本）→ 交给 DeepSeek 在翻译时一并判断，原文已经是中文的就返回空译文。
  - 如果实测发现规则误判较多，可以换用轻量的 JS 语言检测库，记入 `DECISIONS.md`。
- 批量翻译：每次调用处理约 20 条评论，输入输出都用 JSON，以 `review_id` 对应。
- 译文风格：忠实、口语化，保留语气和情绪，不润色，不总结。

### 7.2 App 周度摘要

输入：App 基本信息、最近 30 天的评论（优先低分评论，数量有上限）、评分和排名走势。

输出 JSON：

```json
{
  "one_liner": "一句话说明这个 App 是什么、给谁用",
  "positioning": "定位与核心功能",
  "loved": ["用户喜欢的点"],
  "complaints": [{"theme": "抱怨主题", "share": "大致占比或频次", "example_review_ids": ["..."]}],
  "rating_trend": "评分变化及可能原因",
  "notable_changes": "近期版本或排名的显著变化",
  "opportunity_hint": "从用户抱怨里看出的未满足需求（可以为空）"
}
```

只对每个榜单前 50 的 App 生成，并且只在评论有新增时重新生成。

### 7.3 品类周度简报

输入（由程序先算好，不让大模型自己算数字）：
- 本周新进榜的 App（过去 7 天没有出现在该榜单的）；
- 排名上升最快、下降最快、掉出榜单的 App；
- "低评分高排名"列表（评分 < 4.0 且排名 ≤ 30，阈值可配置）；
- 该品类前 50 名 App 近 30 天的低分评论样本（1–3 星，按 App 均衡抽样）。

输出 JSON：

```json
{
  "headline": "一句话概括本周该品类最值得注意的变化",
  "new_entries": [{"app_id": 0, "note": "为什么值得关注"}],
  "movers": [{"app_id": 0, "direction": "up|down", "note": "..."}],
  "pain_points": [{"theme": "痛点主题", "description": "...", "frequency": "高|中|低", "example_review_ids": ["..."]}],
  "opportunities": [{"signal": "观察到的信号", "reasoning": "为什么可能是机会"}]
}
```

## 8. 前端与 API

### 8.1 总体

- 默认显示中文，**全局一个开关可以切换"中文 / 原文"**；每条评论也可以单独切换。
- 筛选条件同步到 URL 参数（方便收藏和分享），并用 localStorage 记住上次的选择。
- 桌面端优先，手机上也能正常浏览。

### 8.2 页面

**顶部筛选栏（始终显示）**：国家/地区、品类、榜单类型、日期（默认最新）。

**品类页（首页）**
1. 品类简报卡片（最新一周）：headline、痛点、机会、新进榜和急升 App。点击 App 可以跳转到详情页。
2. 榜单表格：排名、相对昨天和 7 天前的排名变化、图标、名称（附一句话中文简介）、开发者、评分、评分数、价格。
3. 标签：🆕 新上榜、🚀 急升（7 天内上升 ≥ 20 名）、⚠️ 低分高排名。
4. 快捷筛选：只看新上榜、只看急升、只看低分高排名。

**App 详情页**
1. 基本信息：图标、名称、开发者、价格、评分和评分数、版本、更新时间、商店链接。
2. 走势图：在该 App 所在各个榜单中的排名走势，以及评分走势。
3. AI 摘要（最新一周）。
4. 评论列表：默认低分优先、时间倒序；可以按星级筛选；显示中文译文，可切换原文；分页加载。
5. 原始描述（默认折叠）。

### 8.3 API（只读）

```
GET /api/meta                                   国家/地区、品类、可用日期
GET /api/charts?country&genre&chart&date        榜单（附排名变化和标签）
GET /api/briefs?country&genre&week              品类简报
GET /api/apps/:id?country                       App 详情 + 摘要
GET /api/apps/:id/ranks?country&days            排名走势
GET /api/apps/:id/reviews?country&rating&page   评论
```

所有查询都要参数化，并给 API 加短时缓存（数据每天只更新一次）。

## 9. 配置（config.yaml）

配置文件用 YAML，方便直接修改不用改代码。加载时用 zod 校验，校验失败就直接报错退出。

```yaml
countries: [us, cn, jp]
genres: [0, 6007, 6000, 6017, 6013, 6020, 6015, 6002, 6027, 6008, 6012, 6026, 6006,
         6023, 6003, 6024, 6005, 6009, 6018, 6011, 6016]
charts: [free, paid, grossing]
chart_limit: 100
reviews:
  top_n_per_chart: 50
  pages_per_day: 1
  backfill_pages: 3
http:
  requests_per_second: 1
  max_retries: 4
llm:
  provider: deepseek
  model: "<按官方文档填写>"
  translate_batch_size: 20
  daily_budget_cny: 10
flags:
  low_rating_threshold: 4.0
  low_rating_max_rank: 30
  surge_rank_delta: 20
```

## 10. 密钥与安全

| 变量 | 用途 | 存放位置 |
|---|---|---|
| `DATABASE_URL` | Railway Postgres 连接串 | GitHub Secrets；本地 `.env`（必须写进 `.gitignore`） |
| `DEEPSEEK_API_KEY` | 大模型 | GitHub Secrets；本地 `.env` |
| Hyperdrive 绑定 / 数据库连接 | Pages Functions 查询数据库 | Cloudflare 项目配置 |

- 给前端 API 使用的数据库账号**只授予只读权限**，和采集管道用的账号分开。
- 网站用 Cloudflare Access 保护，只允许我的邮箱登录。

## 11. 里程碑与验收

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| **M0 接口验证** | 写脚本实测第 3 节的所有端点：3 个国家/地区、品类筛选、畅销榜、lookup 批量上限、评论分页和上限、Genre ID 是否正确 | 输出一份验证报告：每个端点是否可用、字段样例、和本文档的差异 |
| **M1 采集入库（不含 AI）** | 数据库迁移、榜单/详情/评论采集、job_runs 日志、命令行参数 | 本地跑通一次全量采集，打印各表行数、耗时、失败数，以及估算的每日数据量 |
| **M2 前端原型** | 前端 + Pages Functions，本地用真实数据跑（`wrangler pages dev`） | 能完成：选国家/地区和品类 → 看榜单和标签 → 点进 App 看详情、走势和评论 |
| **M3 AI 处理** | 翻译、App 摘要、品类简报、预算控制 | 抽查 20 条译文质量；生成 2 个品类的简报给我看；报告 token 用量和费用 |
| **M4 部署** | GitHub Actions 定时任务、Cloudflare Pages 部署、Hyperdrive、Access | 定时任务连续成功运行 3 天；线上网站需要登录才能访问 |
| **M5 调优** | 根据实际数据量和费用调整参数，检查数据库体积增长 | 给出每日费用、每月数据库增长量和优化建议 |

## 12. 已知风险

1. **旧版 RSS 接口随时可能失效**（品类榜和畅销榜依赖它）。必须有降级方案和明确的告警日志。
2. **评论上限约 500 条**：历史评论只能靠每天增量积累，采集中断就会丢数据。
3. **中国大陆访问 `*.pages.dev` 可能不稳定**。如果遇到，就绑定自己的域名。
4. **Railway 按用量计费**：M5 时评估存储增长和费用。
5. **GitHub Actions 运行在海外**：抓取中国区数据用 `country=cn` 参数即可，不受影响。M0 时确认一下。

## 13. 决策边界

### 13.1 固定约定（不能自行更改，要改先问我）

| 类别 | 内容 |
|---|---|
| 产品范围 | 3 个国家/地区、20 个品类加总榜、3 种榜单、前 100 名、不含游戏（第 2 节） |
| 体验原则 | 所有 AI 内容在后台预先生成，网页只做查询；默认显示中文，可切换原文 |
| 页面结构 | 筛选栏 → 品类页（简报 + 榜单 + 标签）→ App 详情页（信息、走势、摘要、评论）（第 8 节） |
| 架构组件 | GitHub Actions、Railway Postgres、Cloudflare Pages + Functions、Cloudflare Access、DeepSeek |
| 语言 | 全部使用 TypeScript，pnpm monorepo，顶层目录结构 |
| 数据语义 | 榜单按"每天一行、存完整排名数组"压缩存储；评论按 ID 去重；译文和原文存在同一行；任务日志写入 job_runs |
| AI 输出格式 | 第 7 节的 JSON 字段（前端依赖这些字段；可以新增字段，不能删改已有字段） |
| 抓取规范 | 限速、退避重试、旧版接口失效时降级并记录日志（第 3、6 节） |
| 成本控制 | 每日预算上限，评论只抓前 50 名的 App，摘要每周生成一次 |
| 安全 | 密钥只放环境变量；前端接口用只读数据库账号；网站必须加登录保护 |
| 工作流程 | 按里程碑推进，每个里程碑完成后停下来等我验收 |

### 13.2 由你决定（按实际情况择优，每项在 DECISIONS.md 记一行理由）

| 类别 | 内容 |
|---|---|
| 依赖库 | HTTP 客户端、图表库、UI 组件、日期处理、CLI 框架等 |
| 数据库细节 | 列类型、可选字段、索引；Drizzle 不适用时的替代方案；Hyperdrive 还是直连 |
| 接口参数 | lookup 批量大小、并发数、实际限速值（以 M0 实测为准） |
| 实现细节 | 模块划分、错误处理方式、日志格式、缓存策略、测试的范围和深度 |
| 提示词 | 翻译、摘要、简报提示词的具体写法（输出格式必须符合第 7 节） |
| 视觉 | 页面配色、排版、组件样式（保持简洁、信息密度高） |
| 运维 | cron 的具体时间、GitHub Actions 的分步方式、部署脚本 |

### 13.3 遇到以下情况，停下来问我

- 实测发现某个数据源不可用，或者数据和本文档描述差别很大；
- 估算的每日 DeepSeek 费用或数据库增长明显超出配置预期；
- 需要引入新的付费服务，或者改变架构组件；
- 某个固定约定在实现上很难做到，或者明显不合理。
