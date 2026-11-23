# 数据可视化与 SQL 工作台 — 产品需求文档与开发指导

**版本：** v1.0（需求基线／实施设计草案）  
**日期：** 2026-10-23  
**状态：** 已确认需求已固化；少量工程参数待实施时确定  
**目标部署：** Windows 本地开发、Docker 自部署、未来公司内网服务器  
**目标用户：** 首期个人使用；设计上预留团队协作与权限扩展

> 文档约定：**[确认]** 表示用户明确提出的目标需求；**[设计]** 表示为实现该需求提出的实现约束；**[建议默认]** 表示尚未确认、可配置或可在实施阶段调整的参数。阶段安排是建议实施顺序，不降低最终范围。

## 1. 产品定位、目标与非目标

### 1.1 定位

自建 Web 数据工作台：统一完成**数据导入、SQL 编写和运行、跨数据库查询、数据库对象管理、计划调度、结果缓存、ECharts 高级可视化、Dashboard 管理**。最终提供可二次开发的长期产品，而非一次性脚本或仅能做图的 BI 工具。

### 1.2 产品成功标准

1. 无需离开工作台，完成“连接数据库 → 编写 A/B/C 多段 SQL → 获取 C 结果 → 创建图表 → 保存 Dashboard → 配置刷新 → 查看执行记录”的闭环。
2. 小数据可直接粘贴，大文件及大查询结果不依赖浏览器一次性装载；支持**千万行级结果的存储、检索、管理和可视化数据准备**。
3. Dashboard 重新打开时，能够从已保存的 Dataset 版本或可访问的数据源复现图表；刷新失败不得覆盖上一次成功版本。
4. 原始数据和 SQL 结果不可在结果网格内直接改写；显示格式可以单独配置。
5. 核心服务使用自有代码与开源组件、模块化接口；本地 Docker 和服务器环境采用同一部署模型。

### 1.3 非目标／不做无依据承诺

- 不把数据库原始 1,000 万行全部一次性传到浏览器进行普通图表渲染。
- 不实现替代 DBeaver 全部功能的数据库管理图形界面：**原生 SQL 执行和对象浏览是核心**；复杂对象管理可以先通过 SQL 实现。
- 不承诺原生 PostgreSQL/Redshift SQL 能在 Trino 跨库模式逐字兼容。
- 不以自定义 JavaScript/JSON 配置编辑器作为必备用户交互；内部仍需生成合法 ECharts 配置。
- 多人协作、共享与细粒度权限不作为首个可用版本的上线门槛，但数据模型和鉴权边界须可扩展。

## 2. 术语与资源所有权

| 对象 | 严格定义 | 持久化内容 |
|---|---|---|
| Workspace（工作空间） | 管理 Dashboard 与关联资源的逻辑容器 | 名称、资源引用、设置；未来所有者与权限 |
| Connection（连接） | 到一个目标数据库/查询引擎的连接配置 | 类型、标识、密钥引用、可用权限 |
| Query（查询定义） | 一组有序 SQL Steps 和执行模式 | SQL 正文、顺序、最终输出步骤、参数、修订版本 |
| Dataset（数据集） | 具名、稳定、可复用的数据接口 | 来源、Schema、刷新策略、当前成功版本指针 |
| Snapshot（数据版本） | Dataset 某次成功生成的**不可变结果** | 文件位置、行数、Schema、版本、时间、大小 |
| Chart（图表） | 对 Dataset 的显示配置和数据映射 | 图表类型、系列、轴、样式、变换/可视化参数 |
| Dashboard（仪表板） | 图表和数据集等资源的组合文档 | 布局、图表引用、筛选器、资源依赖清单 |
| Job（任务） | 一次可执行动作（查询、更新表、刷新 MV 等） | 定义、触发规则、超时、重试与执行记录 |
| Pipeline（任务链） | 按依赖有序/有向无环执行 Job | 节点与依赖边、失败策略 |
| Run（执行实例） | 一次具体执行尝试 | 开始/结束、状态、日志、错误、产物关联 |

**[设计] Dashboard 有“文件”的使用体验，但内部不能把它设计成唯一的数据存放处。** Dashboard 保存自身配置与资源引用；导入文件、缓存结果由 Dataset/Snapshot 管理。支持同一个 Dataset 被多个 Dashboard 引用；删除 Dashboard 不删除仍被引用的数据。若未来需要打包、迁移、导出 Dashboard 文件，可用 Manifest + 数据版本文件封装，不改变内部模型。

## 3. 用户操作闭环与界面信息架构

### 3.1 主要导航

- **Workspace / Dashboards：** 查看、新建、保存、打开与管理 Dashboard。
- **Datasets：** 粘贴、上传、创建 SQL Dataset；查看 Schema、数据预览、版本和保留策略。
- **SQL Editor：** 选择连接和执行模式、编辑多段 SQL、运行、保存、历史、对象浏览器。
- **Charts：** 从 Dataset 创建图表，字段绑定与配置、预览、保存。
- **Jobs / Pipelines：** 手动运行、设定计划、配置依赖、重试、查看日志与失败通知。
- **Connections / Settings：** 数据库连接、权限和安全设置、存储与运行限制。

### 3.2 典型路径

**粘贴路径：** 复制表格 → 粘贴 → 预览和确认列类型 → 保存为 Dataset → 创建 Chart → 保存 Dashboard。

**上传路径：** 选择文件 → 上传/流式导入 → 结构与错误校验 → 生成不可变 Snapshot → 创建 Dataset → 配图 → Dashboard。

**SQL 路径：** 连接数据库 → 编辑 SQL Steps A/B/C → 运行 → 指定 C 为最终结果 → 保存 Query / Dataset → 图形化配置 → 保存 Dashboard。

**调度路径：** 对 Job/Dataset 选择手动或 Cron/周期 → 定义依赖与失败处理 → 执行 → 若成功原子更新 Dataset 当前版本 → Dashboard 重新取数。

### 3.3 关键交互统一规则

- 任意界面返回后，保存过的 SQL、字段映射、图表配置和 Dashboard 布局保持一致。
- 编辑已有 Dataset 的 SQL 不立即替换当前可见数据：先保存查询修订，执行成功后创建新 Snapshot 并切换指针。
- 执行失败显示报错、步骤、时间与日志入口；已成功的旧数据持续可用，并标明旧版本时间与失败状态。
- 无可用数据时显示明确状态（从未成功、数据源不可访问、当前版本已过期、权限不足），而不是空白图表。

## 4. 数据输入与 Dataset 需求

### D-01 粘贴数据 [确认]

- 支持来自 Excel、Google Sheets、文本表格的制表符分隔内容（TSV），也支持 CSV 文本。
- 预览表头、行列数、字段名、数据类型推断；允许在**导入确认阶段**纠正字段类型和解析配置；不允许在保存后的结果表中直接改值。
- 区分空值、空字符串、数值 0、日期及时间戳；不因自动推断造成静默数据损坏。
- 粘贴数据保存为持久 Dataset；重开 Dashboard 不依赖剪贴板内容。
- **验收：** 100 行 × 多列内容粘贴、保存、关闭页面、重开后行列/类型一致，0.1234 可在图表中显示为 12.34%。

### D-02 文件导入 [确认]

- 初期实现 CSV/TSV；Parquet 建议在大数据阶段优先实现，XLSX 支持作为便利格式但不作为千万行的承载格式。
- 大文件采用流式接收、后台解析、增量写入列式存储；导入进度与失败报告可查看，不能占满服务内存。
- 按源文件保存不可变原始数据或可追溯的规范化版本；校验列数、数据类型、编码、坏行策略；导入失败不生成伪成功 Dataset。
- 重复上传同名文件不静默覆盖旧版本；作为新 Snapshot 或独立 Dataset 由用户明确选择。
- **验收：** 大于内存可安全容纳的数据文件通过流式方式完成导入；导入后行数、列类型、空值数和校验摘要一致。

### D-03 SQL Dataset [确认]

- Dataset 记录其来源 Query、最终输出步骤、执行模式和所用连接，允许手动重跑及由 Job 刷新。
- SQL 结果在需要持久展示时保存为 Snapshot；一个 Dataset 同时维护当前成功版本和历史版本索引。
- **[设计] 为避免来源失效导致 Dashboard 丢失，本系统默认持久保留最近一次成功结果（可在保留策略下调整其他历史版本）。**
- SQL 修改须保留 Query 修订历史；历史查询和历史 Snapshot 是两个概念，不可混用。
- **验收：** 禁用源库连接后，已成功缓存的 Dashboard 仍可展示，显示数据时间与离线状态。

### D-04 字段与显示格式 [确认]

- Dataset 保存物理/逻辑列名、类型、是否可空及必要元信息；Chart 单独保存字段映射和显示规则。
- 显示格式包括原值、数值小数位、千分位、百分比、货币（需配置币种）、日期/时区、单位前后缀。
- 百分比规则明确：底层值 0.1234，选择“比例型百分比”显示 12.34%；**不改写** Dataset 中的 0.1234。需要避免与已存为 12.34 的百分数重复乘 100。
- 图表的聚合、排序、筛选属于**只读展示计算**，不会回写 Dataset；统计口径（SUM、AVG、COUNT、DISTINCT、分母及过滤条件）须可审查。
- **验收：** 仅修改显示格式，Snapshot 校验和和 SQL 查询结果不变。

## 5. SQL 编辑器与数据库操作

### Q-01 数据库连接 [确认]

- 首批：Amazon Redshift、PostgreSQL；支持同类型多连接及连接测试。
- 展示连接名、数据库/Schema、可见 table/view/materialized view（MV）/列，支持搜索及插入对象名到 SQL。
- 连接凭据由后端安全保存，浏览器永不拿到明文数据库密码；区分只读分析连接和具备写权限的管理连接。
- **验收：** 同时连接 proddb（Redshift）与 nkreport（PostgreSQL），分别浏览其 schema 和对象，并可执行查询。

### Q-02 多段 SQL [确认]

- 一份 Query 由有序 Steps（A、B、C…）构成，每段可包含数据库允许的 SQL 语句；指定**唯一的输出 Step**，该 Step 的结果集成为 Dataset 来源。
- 原生执行模式中，依次在**同一物理连接/会话**运行需要共享 TEMP TABLE 的步骤；不可因连接池切换破坏临时对象。
- 每个 Step 可以包含多个数据库语句，解析时须正确处理字符串、注释及 PostgreSQL 的过程语言代码块，**禁止简单按分号字符串切割**。输出 Step 必须唯一确定结果集；如同一步返回多个结果集，必须显式指定要保存的结果集，不得随机选择。
- 各步骤显示状态、耗时、影响行数（驱动支持时）和错误；非输出步骤不自动作为 Chart Dataset。
- 不在失败后跳过依赖步骤；取消操作中止后续步骤，并尽可能取消正在运行的语句。
- **事务语义：** 由数据库方言及可配置的事务模式控制；不能隐式承诺跨多条 DDL/DML 全部原子回滚。默认按显式会话和事务策略运行，异常回滚能力须在界面注明。
- **验收：** A 建临时表、B 基于它加工、C SELECT，执行后只生成 C 的 Dataset，单段失败保留错误现场。

### Q-02A SQL 执行示例（用于对齐设计）

Native 模式（同一数据库会话）：

```sql
-- Step A: prepare
CREATE TEMP TABLE a AS SELECT userid, COUNT(*) AS n FROM events GROUP BY 1;
-- Step B: process
CREATE TEMP TABLE b AS SELECT * FROM a WHERE n >= 5;
-- Step C: output (仅此步骤作为 Dataset)
SELECT userid, n FROM b ORDER BY n DESC;
```

Federated 模式（不同数据源，以 Trino catalog 为例；表名只作语法示例）：

```sql
SELECT r.userid, p.segment
FROM redshift_catalog.public.user_activity AS r
JOIN postgres_catalog.public.user_segment AS p
  ON r.userid = p.userid;
```

原生模式的 TEMP TABLE 生命周期属于指定数据库连接；联邦模式的 catalog 不是原生数据库会话的临时表容器。两种 SQL 必须分别验收。

### Q-03 SQL 保存与查询历史 [确认]

- 支持保存 Query 名称、SQL 文本、Step 顺序、执行模式、目标连接、参数和修订版本。
- 查询历史记录手动/定时运行、执行人或服务身份、步骤状态、时间、耗时、影响行数（可获取时）、错误摘要及 SQL 修订 ID。
- 历史执行与 Query 版本可关联，但执行历史不自动保存每次完整结果；结果由 Dataset 的 Snapshot 保留策略控制。
- 避免将密码、Token、敏感参数原值写入历史日志。
- **验收：** 保存 SQL → 修改 → 再运行 → 能找回两个修订版本和对应运行记录。

### Q-04 原生数据库管理 SQL [确认]

- 支持执行数据库原生 SQL：CREATE / ALTER / DROP TABLE、VIEW、MV；INSERT / UPDATE / DELETE；REFRESH MATERIALIZED VIEW；以及数据库支持的其他管理 SQL。
- 权限由目标数据库授权和系统连接角色双重约束；工作台不应绕开数据库权限。
- 对 DROP、TRUNCATE、无 WHERE 的 UPDATE/DELETE 等高风险操作触发确认：显示连接、schema、对象/SQL 摘要，并要求人工确认；同时保留审计记录。
- 调度任务执行写操作时**不要求交互式确认**，但须在任务保存/启用时进行授权确认及权限检查。
- 执行管理 SQL 与结果展示相互独立：DDL、DML 可以没有数据结果集，状态和影响范围仍应返回。
- **验收：** 有权限的管理连接能 CREATE/REFRESH/DROP，只有 SELECT 权限的连接执行 DROP 必须失败且显示数据库错误。

### Q-05 跨库联邦查询 [确认]

- 首选 Trino 查询联邦层，通过 catalog.schema.table 的全限定名称查询 Redshift 与 PostgreSQL，并执行跨库 JOIN。
- 在 UI 中明确区分 **Native** 和 **Federated** 两种执行模式，语法提示、可用 SQL 和权限范围不同。
- **关键边界：** 跨库 `SELECT/JOIN` 与“同一数据库会话中的多步 TEMP TABLE 脚本”不是同一种执行能力。联邦查询对多段流程需要 Pipeline 编排和持久化中间产物；不将 Trino 假定为两个源库的共享临时表会话。
- **[设计] 多步跨库计算最终采用 Step 输出物化到受控 staging Dataset，再由后续 Step 引用的方案；阶段 3 交付。** 初期可使用专用 staging PostgreSQL，并通过 Trino catalog 引用；大体量中间数据可再评估对象存储 + Trino 可查询的 Iceberg/Hive 表格式。**仅写入 Parquet 文件并不会自动让 Trino 能查询它。** staging 有生命周期和清理策略，且应标明数据移动的目的地与体量。
- 跨库 JOIN 可能涉及大量数据移动；必须显示执行计划/数据移动提示（能获取时），并提供超时和资源限制。对数据出网或复制有禁令时须阻止落地。
- **验收：** 两库各有测试表，Trino 能按 key JOIN 并产生正确结果；复杂原生数据库 DDL 仅由 Native 模式执行。

## 6. 千万行规模与结果缓存

### L-01 规模口径 [确认]

“支持千万行级结果”具体指：允许 SQL/文件产生这一数量级的 Dataset；可完整持久化、版本化、查询、筛选、导出、参与后端聚合；不要求浏览器同时持有全部行。支持的**实际字节数**还受存储空间、列数、数据类型、源库性能及管理员可配置配额限制。

### L-02 存储与访问 [设计]

- 数据平面：导入与 SQL 结果按分块/流式处理并写为 Parquet/Arrow 友好形式；大结果采取分区/分文件和 Schema 元数据索引。
- 元数据平面：应用专用 PostgreSQL 保存 Workspace、Dataset、Snapshot、Query、Chart、Dashboard、Job 等；**不得把应用元数据默认写进业务用的 nkreport**。
- 结果访问：Dataset 查询接口支持服务端过滤、排序、分页、列投影；默认仅返回当前屏幕需要的行/列。
- 图表数据准备：优先服务端 GROUP BY、聚合、筛选及 Top-N；必要时抽样，并在 UI 标记“抽样”、样本数与来源。精确统计不得由抽样结果冒充。
- 大结果的排序与复杂过滤允许较慢并提示进度/代价；不得在浏览器中对千万行完整排序。
- 文件导出为后台生成和分块下载；导出的数据范围明确区分“全量 Snapshot”与“当前图表筛选结果”。
- Redshift 量大时可评估 S3 + UNLOAD Parquet 高效导出，但不作为部署到本地时的硬性依赖。

### L-03 Snapshot 生命周期 [确认 + 设计]

- 每个 Dataset 配置**独立保留策略**：仅当前最新、保留最近 N 个成功版本、保留 T 天、或自定义上限组合；应支持手动固定某个历史版本，固定版本不因自动清理而删除。
- **[设计] 推荐默认：保留最近一次成功 Snapshot；历史保留策略可选。** 不能因为预设“只保留最新”而删掉正在被固定引用的历史版本。
- 刷新成功：先完整写入新 Snapshot → 校验 Schema/产物 → 数据库事务中切换 `current_snapshot_id` → 异步清理过期版本。失败：当前指针保持不变。
- 旧版数据如与新版 Schema 不兼容，相关图表不得静默映射错误字段；保留旧图显示或提示修复字段映射。
- **验收：** 产生 3 个结果版本、设为保留 2 个、锁定最早版本 → 自动清理后最近 2 个及锁定版本存在；失败运行不会替换当前版本。

### L-04 容量与验收环境 [待配置]

- 必须明确测试机器的 CPU、RAM、磁盘、测试数据列宽、源库连接带宽和查询复杂度，才能制定合理耗时 SLA。
- 性能测试至少覆盖：**1,000 万行 CSV/Parquet 导入、1,000 万行 SQL 结果持久化、服务端分页和筛选、聚合后绘图、重开 Dashboard、保留策略清理**。
- 合格判据首先是正确性、稳定性、内存有界、失败可恢复；毫秒级延迟等数值目标在基准环境确定后再签署。

## 7. 数据刷新、调度与依赖

### J-01 触发方式 [确认]

- Job 支持立即手动运行、固定时间/间隔/Cron 运行、手工重跑某个历史任务；记录计划触发时间和实际执行时间。
- Dataset 刷新与数据库对象刷新是不同 Job 类型：前者重算并保存 Snapshot，后者执行对 table/view/MV 的 SQL 操作。
- Dashboard 自动刷新是“重新取得 Dataset 的当前版本/图表数据”，不等于自动执行 SQL 或刷新 MV；UI 必须区分这两种刷新。

### J-02 依赖执行 [确认]

- Pipeline 为 DAG；依赖节点必须成功后才允许下游执行。
- 支持典型链：`刷新 DETAIL → 刷新 TOPIC → 刷新 APP → 重算 Dataset → 更新 Dashboard 数据`。
- 禁止依赖环；同一 Job 可被多个 Pipeline 复用，但每次运行保留独立上下文和追踪 ID。
- **[设计] 默认只有全部必要前置节点成功才推进；失败会阻断依赖节点，用户可从失败节点手动重跑。**

### J-03 失败重试及通知 [确认]

- 可逐 Job 配置最大重试次数、重试间隔/退避、超时、失败通知渠道（至少通过可扩展通知接口集成一种渠道）。
- **关键安全：** 对有副作用的 INSERT/UPDATE/DROP/REFRESH，自动重试不能盲目从整条 Pipeline 的第一步重跑。须标明 Job 的幂等性（idempotent / guarded / manual-only）和具体重试策略；默认**写操作未经幂等确认不自动重试**。
- 通知至少包含 Job、执行 ID、首次失败时间、最终失败状态、错误摘要、日志入口；只在配置条件满足时发送，避免重试风暴中重复通知。
- 同一 Job 到点时前一个实例仍在执行：策略可配，建议默认不并发（排队/跳过须明确）。

### J-04 状态模型与验收

`PENDING → QUEUED → RUNNING → SUCCEEDED / FAILED / CANCELLED / TIMED_OUT / BLOCKED`。失败重试要另记 `attempt_no`，不覆盖旧尝试日志。

验收：给 A→B→C 任务链，B 第一次失败、第二次成功，则 C 只在 B 成功后执行；B 一直失败则 C 状态为 BLOCKED，Dataset 当前 Snapshot 不变，并产生最终失败通知。

## 8. ECharts 高级图形化设计器

### V-01 设计目标 [确认]

尽可能覆盖安装版 ECharts **全部标准图表类型及主要配置能力**，用户不用手写 ECharts Option JSON/JavaScript。允许分阶段实现图表类型，但最终架构必须是可扩展的，不将所有设置硬编码进单一大表单。

### V-02 图表类型体系 [设计]

采用**图表注册机制**。每种图表定义：`type_id`、输入数据 Schema 要求、维度与度量的角色、默认配置、可编辑字段 Schema、配置校验器、ECharts Option 生成适配器、示例和迁移版本。

覆盖集合以 ECharts 安装版本的**官方 Chart Types / Examples 清单**为准，不局限于折线、柱状、饼图。分阶段覆盖包括：line/area、bar、scatter、pie/doughnut、radar、heatmap、boxplot、candlestick、funnel、gauge、treemap、sunburst、tree、graph、sankey、map/geo、parallel、calendar、pictorialBar、themeRiver 及其他对应发行版标准类型。部分类型依赖特定数据形状或地图资源，不保证任何二维表能直接转换到任意类型。ECharts-GL 等**外部扩展不属于标准核心库**，另列扩展范围。

### V-03 统一图形化属性面板 [确认 + 设计]

- **数据：** Dataset 选择；维度、度量、系列、分组、聚合、排序、过滤、Top-N、空值与缺失日期处理（显示层）；清晰展示统计口径。
- **图表：** 类型切换、系列增删、stack/group、折柱组合图、双 Y 轴、轴类型与尺度、区间、坐标系（适用时）。
- **样式：** 标题/副标题、颜色/调色板、背景、主题、边框、字体、Label、Legend、Tooltip、网格/边距、参考线/标注/标记区域。
- **交互：** tooltip、legend 选择、dataZoom、筛选联动、brush（适用时）、数据缩放和图表工具栏。
- **格式：** 数字/日期/百分比/货币、精度、缩略单位与缺失值显示；按字段或系列配置。
- **布局与响应式：** 图表尺寸随容器调整；设计器预览与 Dashboard 实际呈现应一致。

配置面板仅显示图表适用的属性，不适用的属性隐藏/禁用；非法配置必须在保存前提示。高级配置范围由注册器的 Schema 决定，不让用户编辑代码。

### V-04 配置生成和兼容性 [设计]

- UI 存的是**稳定的 ChartConfig（产品自己的 Schema）**，后端/前端适配器生成 ECharts Option，而非把未经验证的 Option 当唯一持久化对象。
- ChartConfig 有 schema_version；组件升级时执行迁移或向后兼容处理，避免 ECharts 升级导致历史 Dashboard 失效。
- 系统内部既可使用 ECharts `dataset + encode`，也必须允许特定类型适配器生成 `series.data`；不能假设所有图表都通用同一种映射格式。
- 导出的图片、图表数据与配置版本须记录所使用 Snapshot 或查询时间。

### V-05 图表验收

- 同一 Dataset 创建至少折线、柱状、饼图、散点与组合图；分别改标题、颜色、轴、百分比格式并保存，刷新后配置不丢失。
- 切换图表类型时，无效字段配置必须提示、可回退；不得静默丢掉 SQL 或源数据。
- 柱/折组合图、双轴、百分比、Top-N、筛选联动执行结果可和原始 Dataset 明细交叉核对。
- 不兼容数据形状的图表类型显示所需字段约束及修复建议。

## 9. Dashboard 与工作空间

### B-01 保存与组织 [确认]

- 创建 Dashboard；添加多个 Chart，且不同 Chart 可以分别来自上传 Dataset、粘贴 Dataset、SQL Dataset。
- 支持拖拽布局、缩放卡片、标题、保存草稿/修改、重新打开并继续编辑。
- Dashboard 使用“文档/文件”交互模型（目录及列表），引用资源可复用。每次渲染图表绑定具体 Dataset 当前版本或固定版本。
- 删除 Chart 不影响 Dataset；删除 Dashboard 不级联删除被其他对象引用的 Dataset。

### B-02 数据刷新与状态 [确认 + 设计]

- Dashboard 显示每个数据集的来源、最新成功刷新时间、当前版本、失败/过期状态；支持单 Dataset 手工刷新及相关 Pipeline 触发入口。
- 已缓存 Snapshot 且数据库断开时允许只读展示，不允许把旧数据显示成“刚刷新”。
- 若同一 Dashboard 多图需要严格同一批次数据，可提供 **[后续设计] Dashboard 发布版本 / 一致性快照组**；普通模式展示各自最新成功版本并分别标注时间。
- **验收：** 一个 Dashboard 关联上传 Dataset 1、SQL Dataset 2、SQL Dataset 3；重开后布局与引用完整，单独刷新 Dataset 2 不会重写其他 Dataset。

## 10. 技术架构（实施建议）

### 10.1 架构原则

- 控制平面（资源、配置、审计、调度元数据）与数据平面（大数据文件、SQL 执行、图表数据）分离。
- 系统管理数据库与公司生产分析库分离；数据库原生连接与联邦查询引擎分离。
- 后台异步工作负责长 SQL、文件导入、定时任务、全量导出，HTTP 请求仅创建/查询任务状态。
- 存储和执行引擎通过接口替换，避免单机 MVP 与未来内网部署两套应用代码。

### 10.2 推荐技术栈（非用户指定，可替换）

| 层 | 推荐选型 | 作用／边界 |
|---|---|---|
| 前端 | React + TypeScript + Vite | Web 工作台 UI |
| SQL 编辑 | Monaco Editor | 编辑、多步骤、语法提示（按方言） |
| 图表 | Apache ECharts | 内置图形化配置器的渲染内核 |
| 数据表格 | AG Grid Community 或 TanStack Table + 虚拟列表 | 虚拟滚动／服务器分页（确认采用功能的许可证） |
| 后端 API | Python FastAPI | 鉴权、资源管理、运行编排、SQL 接口 |
| 元数据 | 独立 PostgreSQL | 资源模型、Job、Run、版本和审计 |
| 数据文件 | 本地挂载卷（开发）→ S3 兼容对象存储（部署可选） | 上传源文件、Parquet Snapshot |
| 数据读写 | PyArrow + DuckDB/Polars（选一套主要查询路径） | 列式文件、服务端筛选/聚合；需验证并发读写方式 |
| 异步执行 | 队列 Worker + Redis（如 Celery） | 导入、SQL、导出、执行重试 |
| 调度 | 持久化调度器 + 任务 DAG 服务 | Cron、依赖、并发锁、失败重跑 |
| 原生数据库连接 | PostgreSQL 驱动、Redshift 官方兼容驱动 | Native SQL、DDL、DML、会话控制 |
| 联邦查询 | Trino（阶段 3 可独立部署） | 跨 Redshift/PostgreSQL catalog JOIN |
| 部署 | Docker Compose 起步 | 本地与公司内网一致部署方式 |

### 10.3 请求与执行链

```text
Browser (React)
  ├─ SQL Editor / Dataset / Chart Designer / Dashboard
  └─ API (FastAPI)
      ├─ Meta DB (independent PostgreSQL)
      ├─ Job Queue + Scheduler + Workers
      │   ├─ Native Executor ── Redshift / PostgreSQL
      │   ├─ Federated Executor ── Trino ── Redshift / PostgreSQL
      │   └─ Import / Export / Snapshot Manager
      └─ Data Store ── source files + Parquet snapshots
```

**注意：** Trino 的 Redshift 和 PostgreSQL catalog 可以做跨库查询，但 JOIN 是否快取决于谓词下推、数据量、网络、执行计划；不能把“可连接”误当成“千万行跨库 JOIN 一定高效”。

## 11. 数据模型与版本管理（逻辑 ERD）

必需实体建议如下，名字可按开发语言统一命名，但关系不可省略。

| 实体 | 核心字段 | 关键约束 |
|---|---|---|
| `workspace` | id, name, created_at | 后续支持 owner_id |
| `connection` | id, type, name, encrypted_secret_ref, capabilities | 密钥不明文输出 |
| `query_definition` | id, workspace_id, name, mode, current_revision | Query 独立于 Dataset |
| `query_revision` | id, query_id, version, steps_json, output_step_id | 修订不可变 |
| `dataset` | id, workspace_id, source_type, query_id?, current_snapshot_id?, retention_policy | 与 Snapshot 一对多 |
| `dataset_snapshot` | id, dataset_id, schema_json, row_count, bytes, storage_uri, created_at, status, run_id | 成功版不可变 |
| `chart` | id, dataset_id, config_json, config_schema_version | 配置不改源数据 |
| `dashboard` | id, workspace_id, name, layout_json, saved_at | Chart 通过关联表引用 |
| `dashboard_chart` | dashboard_id, chart_id, layout_props | 删除引用不删 Chart |
| `job_definition` | id, kind, target_ref, schedule, retry_policy, idempotency, enabled | 运行定义独立 |
| `pipeline_edge` | pipeline_id, upstream_job_id, downstream_job_id | 必须为 DAG |
| `job_run` | id, job_id, trigger, status, started_at, finished_at, attempt_no, log_ref | 不覆盖历史 |
| `query_run` | id, query_revision_id, run_id?, state, engine, error_ref | 追踪 SQL 与任务 |
| `audit_event` | id, actor, action, target, occurred_at, request_id | 高风险变更可追责 |

**[设计]** 文件路径、数据集 ID、图表 ID 不能只依赖显示名称；引用使用稳定 ID。为 Chart、Dashboard、Query 配 `version`/`updated_at` 或乐观锁，防止并发保存覆盖。

## 12. 接口契约与关键执行语义（非最终 OpenAPI）

初期最少需要以下 API 族；路径只是开发约定，可统一调整：

- `POST /connections`、`POST /connections/{id}/test`、`GET /connections/{id}/objects`：连接配置和元数据浏览。
- `POST /queries`、`PUT /queries/{id}`、`GET /queries/{id}/revisions`：SQL 定义与历史修订。
- `POST /query-runs`、`GET /query-runs/{id}`、`POST /query-runs/{id}/cancel`：异步执行、状态和取消；请求含 query_revision_id、运行模式、参数，响应立即返回 run_id。
- `POST /datasets/import`、`POST /datasets/from-query`、`GET /datasets/{id}`：建立 Dataset，上传通过流式/分片机制。
- `POST /datasets/{id}/refresh`、`GET /datasets/{id}/snapshots`、`GET /datasets/{id}/rows`：刷新、版本和数据窗口读取。
- `POST /charts`、`PUT /charts/{id}`、`POST /charts/{id}/preview`：可视化保存与预览。
- `POST /dashboards`、`PUT /dashboards/{id}`、`GET /dashboards/{id}`：Dashboard 生命周期。
- `POST /jobs`、`POST /jobs/{id}/run`、`GET /runs/{id}/logs`、`POST /pipelines`：调度和依赖。

示意数据访问语义：`GET /datasets/{id}/rows?snapshot_id=...&offset=...&limit=...&sort=...`；在千万行规模下，优先设计稳定 cursor/keyset 或扫描语义，不应依赖深 offset 一定高效。筛选表达式用结构化白名单 AST，而不是前端任意 SQL 片段字符串拼接。

**一致性要求：** 先写新数据、再校验、最后指针切换；读者永远看到完整的旧版或新版，不能看到写入一半的结果。执行 Run/Job 状态更新应可重放、幂等，以免 Worker 重启造成“双完成”。

**最小响应契约：** 运行创建返回 `run_id`、`status=QUEUED`；查询运行状态至少返回 `run_id`、`status`、`step_statuses`、`started_at`、`finished_at`、`error`、`output_snapshot_id`（无产物时为 null）。Chart 数据接口同时返回 `snapshot_id`、`data_as_of`、`is_sampled` 和数据范围，避免在前端误把抽样/旧缓存当新鲜全量。

## 13. 安全、权限与运维最低要求

- 开发环境也要将只读连接与可写管理连接隔离；生产数据库的 CREATE/DROP 权限遵守最小权限原则。
- 服务端执行 SQL；前端不得获得数据库密钥；连接信息安全存储与可轮换，日志按规则脱敏。
- 高风险原生 SQL 明确数据库、Schema 与连接角色；手动执行需确认；定时执行在启用 Job 时审批/确认。
- 限制 SQL 超时、单次输出字节数、并行任务数、临时文件空间；容量上限是管理员配置，不破坏最终千万行目标。
- 将 SQL 运行者身份、参数摘要、操作类型、执行结果、影响对象及错误日志纳入审计；错误信息可见性遵循角色权限。
- 公司服务器部署前要满足网络白名单、数据库访问权限、内部数据落盘/备份政策与 TLS。若公司禁止把业务数据长期缓存到应用服务器，应调整 Snapshot 存储策略或申请批准，不能默认复制数据。
- 做应用元数据备份、Snapshot 文件备份和一致性恢复；生产升级前执行数据库迁移并提供回滚步骤。

## 14. 分阶段开发路线图

阶段依据为“能连续形成用户价值 + 风险由低到高”；最终功能仍以本 PRD 为目标。

| 阶段 | 可交付能力 | 阶段退出条件 |
|---|---|---|
| **P0 技术骨架** | Docker、前后端、应用元数据库、身份边界、连接 Redshift/PostgreSQL、资源 ID 模型 | 能测试连接、运行单条只读 SQL、保存查询定义 |
| **P1 可用可视化闭环** | 粘贴/CSV、SQL A/B/C Native、Dataset/Snapshot、SQL 历史、常用 ECharts 图形化编辑、Dashboard 保存/打开 | 从 SQL 结果到 Dashboard 全程可用，数据源断开后可展示上次成功结果 |
| **P2 数据刷新与数据库管理** | DDL/DML 原生 SQL、手工刷新、调度、重试、通知、Job DAG、版本保留策略、审计和服务端数据访问 | A→B→C 任务链稳定，失败不会覆盖 Snapshot；管理 SQL 权限隔离 |
| **P3 大规模与跨库** | 1,000 万行流式导入/缓存验证、Trino 跨库 JOIN、跨引擎 staging、性能及安全约束、大规模导出 | 通过 1,000 万行测试矩阵，跨库 JOIN 结果正确、资源有界 |
| **P4 图表广覆盖与团队部署** | 扩展至 ECharts 标准图表与主要选项、图表注册系统完善、公司内网部署、多人/授权扩展（若需要） | 图表类型支持清单可逐项验收，服务器上数据和 Dashboard 可恢复 |

**风险优先顺序：** 在 P0/P1 就固定 ChartConfig、Dataset/Snapshot、Query Step、Job 接口和存储抽象；尽管 Trino 和千万行导入在 P3 开发，也不能到 P3 才重构基础数据模型。

## 15. 验收测试矩阵（重点场景）

| ID | 操作 | 预期结果 |
|---|---|---|
| AT-01 | 粘贴 0.1234，图表格式选百分比 | 显示 12.34%，Dataset 原值仍为 0.1234 |
| AT-02 | CSV 导入后关闭浏览器、重开 | Dataset 和图表可重复访问，列类型正确 |
| AT-03 | A 建 TEMP TABLE、B 加工、C 输出 | 三段同会话执行，仅 C 作为结果 Dataset |
| AT-04 | SQL 修改后保存并重跑 | 保留旧 SQL Revision、新 Revision 与两次运行日志 |
| AT-05 | Redshift 与 PostgreSQL 关联 JOIN | Trino 返回符合测试用例的结果，展示跨库查询模式 |
| AT-06 | 只读角色 DROP TABLE | 操作被数据库拒绝，无对象破坏，日志完整 |
| AT-07 | 手动启用 DROP/REFRESH Job | 写连接授权、运行对象、审计链路可追踪 |
| AT-08 | Pipeline 的中间节点失败 | 下游不执行；根据策略重试；最终失败通知正确 |
| AT-09 | 新 SQL 查询失败 | 当前成功 Snapshot 指针不变，Dashboard 继续显示旧数据和警告 |
| AT-10 | Dataset 保留 N 版且固定某历史版 | 只清理符合策略且不被固定的版本 |
| AT-11 | 同一 Dataset 在两个 Dashboard 使用 | 刷新 Dataset 后两个引用一致更新，删除一张 Dashboard 不破坏另一张 |
| AT-12 | 1,000 万行导入/持久化与分页 | 行数准确、无浏览器全量装载、后台资源受控 |
| AT-13 | ECharts 类型切换及非法字段 | 给出字段约束与错误，不影响来源 SQL/数据 |
| AT-14 | 应用重启/Worker 重启 | 持久化资源存在，运行状态可恢复/标记，不出现半成品 Snapshot |
| AT-15 | 数据库临时断连并重新访问 Dashboard | 使用最后成功缓存，展示来源不可用和数据时间 |

## 16. 尚未由用户明确确定的实施参数

以下不阻止需求定稿，但不能由开发者私自当成用户已批准的值：

1. **数据源策略：** 公司是否允许复制 SQL 结果到工作台存储？是否仅限公司内网或获批准的对象存储？
2. **文件兼容：** CSV/TSV 必备；Parquet 优先；XLSX 便利支持的实施阶段、编码与超大文件格式限制。
3. **刷新计划：** 采用的 Cron 时区（建议 IANA 名称，例如 Pacific/Auckland）、夏令时跳变、错过计划后的补跑策略。
4. **通知方式：** 首选 Email、Slack 或 Webhook，以及触发门槛和接收人。
5. **任务重试默认：** 只读任务建议允许重试；写任务要求显式幂等声明；次数、间隔、并发数均可配置。
6. **缓存容量：** Dataset 最大磁盘空间、最近版本默认数量、固定版本上限、清理延迟、备份周期。
7. **安全与共享：** 未来单点登录、只读用户、可写用户、审计员、管理员等是否纳入 P4 实施。
8. **性能验收机器：** RAM/CPU/带宽、千万行数据平均行宽以及最小可接受吞吐、查询延迟和图表响应时间。
9. **Dashboard 文件语义：** 是否需要可携带数据的离线包导入/导出，还是只需要系统内的持久化文档/目录。

这些是实施前的配置或后续范围决策；已确认的四类核心功能和高级可视化目标不依赖它们重新立项。

## 17. 开发执行规则与禁止误解

1. **不要把 ECharts 直接当作编辑器。** ECharts 是渲染引擎；图形化配置器、Schema 和适配器需要自研。
2. **不要把图表刷新等同于 SQL 刷新。** 前者重新读取当前 Dataset，后者可能刷新表、MV 或重算 Snapshot。
3. **不要默认“跨库”就能运行任何源库 SQL。** 跨库查询走 Trino；Redshift/PostgreSQL 原生管理 SQL 走 Native；跨库多步依赖通过 Pipeline/staging 明确建模。
4. **不要把 1,000 万行装进浏览器状态。** 大数据存在服务端，图表按视图数据规模取得正确聚合结果。
5. **不要直接修改 Snapshot。** 数据修正通过重新导入或修改源 SQL 形成新版本。
6. **不要让失败刷新污染历史成功数据。** 新 Snapshot 校验通过后才能原子发布。
7. **不要自动重试非幂等写入脚本。** 必须满足安全前提或选择手动重试。
8. **不要将 Dashboard 当成数据表。** Dashboard 保存布局和引用，Dataset 保存数据及版本，Chart 保存展示定义。
9. **不要把显示百分比混同于修改指标值。** 格式是视觉语义；SQL/Dataset 统计口径另行管理。
10. **不要在首版实现大量功能时牺牲可迁移的基础契约。** 优先稳定资源 ID、版本、查询运行、数据快照和图表配置协议。

## 18. 官方技术依据与可行性参考

- Trino Redshift connector（跨系统查询、读写限制、UNLOAD 优化）：https://trino.io/docs/current/connector/redshift.html
- Trino PostgreSQL connector：https://trino.io/docs/current/connector/postgresql.html
- ECharts 官方功能与标准类型：https://echarts.apache.org/en/index.html
- ECharts 官方图表示例：https://echarts.apache.org/examples/en/index.html
- ECharts Dataset 机制及特殊图表的数据组织边界：https://echarts.apache.org/handbook/en/concepts/dataset/
- Redshift UNLOAD Parquet：https://docs.aws.amazon.com/redshift/latest/dg/r_UNLOAD.html

**结论：** 本文已经可以作为开发起点；先根据 P0/P1 产出 UI 原型、逻辑数据模型和 API OpenAPI 草案，再逐项实现及通过验收矩阵。非功能数值在测试环境确认后补充进版本化的实施规格，不应阻碍核心架构确定。
