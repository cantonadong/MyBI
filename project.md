# MyBI 项目开发交接

更新日期：2026-11-18。依据当前 `main` 源码、构建脚本、README 和 Git 历史整理；最近发布为 v1.4（`5534a89`，GitHub Release 含 EXE 与便携 ZIP），各包版本为 1.4.0。下文“已实现”表示有对应实现，不表示本次运行验证通过。

## 1. 项目定位与接手顺序

MyBI 是 Windows 本地可视化报表工具：导入表格或连接数据库，将数据保存为 Parquet 快照，在浏览器编辑图表、筛选控件和多页签报表，并发布只读视图。原生 EXE 是服务管理器，编辑器运行于浏览器，不是内嵌 WebView。

接手时先读 `AGENTS.md`，再读本文件和 `README.md`，最后按任务查看具体源码。`doc/` 是早期需求与测试记录，`docs/superpowers/` 是历次设计和计划；它们提供背景，但不能代替当前代码。不要把历史计划中的目标直接当成已完成功能。

## 2. 已实现的功能

### 数据接入与数据集

- 粘贴表格、导入 CSV/XLS/XLSX；支持工作表选择、编码、分隔符、表头设置和字段预览。
- 字段类型推断、类型调整、转换确认、展示名称、列顺序、丢弃字段、数值格式和文本值标签；支持 Annotation 字段角色。
- 静态数据与动态数据共用接入、字段配置和数据预览流程；编辑现有数据源时保留配置，并处理字段增减。
- 动态数据支持 PostgreSQL/Redshift 连接配置、SQL、表、视图、物化视图，以及对象目录初始化、搜索和刷新。
- 设置中集中管理连接、连接校验、排序、MyQuery 连接共享；连接信息与对象元数据可与 MyQuery 共用。
- 查询校验、耗时展示、完整结果暂存预览、保存预览结果、取消查询；前端关闭/切换操作与后端取消信号有联动。
- 数据集列表、来源查看和编辑、引用关系查询、删除确认、今日缓存读取、强制刷新及缓存文件管理。
- 按报表设置每日时间与 IANA 时区刷新关联动态数据集；后台调度不依赖浏览器，失败保留上一份成功快照。

### 报表与画布

- 报表新建、保存、复制、删除、发布；报表文档有版本控制，多页签可命名与切换。
- 拖拽、缩放、自动布局调整、插入位置预览、辅助线、图表属性配置、图表删除及撤销。
- 图表注册表包含：指标卡、数据表、柱状图、折线图、面积图、组合图、蜡烛图、饼图、散点图、雷达图、漏斗图、仪表盘、瀑布图、热力图、直方图、箱线图、树图、矩形树图、旭日图、桑基图、地图。地图需要用户提供 GeoJSON。
- 多维度、多指标、独立指标聚合、系列分组、双轴、排序、Top N、自动标题和图例、图例交互、配色、数据标签位置/密度/单位等配置；实际可用项随图表类型变化。
- 筛选控件是画布组件：下拉、平铺、级联、日期范围、最近 X 天/周/月/季/年；支持选择、排序和自动日期边界等配置。
- Annotation 数据源、开始日期竖线/日期区间标注、周末高亮、图表说明、图像复制/导出相关实现。
- 图表评论、评论数量、编辑与删除；本地个人资料和头像。

### 设置、发布与桌面管理

- 简体中文/英文界面，默认跟随浏览器；设置中可选择语言，图表语言有独立设置；同步原生管理器语言。
- 图表主题、配色、默认数字显示等设置。
- 本地管理服务默认 `http://127.0.0.1:8000`；独立公网只读监听默认端口 8001，可配置地址和端口，支持公网 IPv4 探测。
- 公网入口限制为已发布报表及相关数据，不开放管理和评论接口；发布链接依赖服务持续运行。
- Rust + Slint 管理器：托盘、启动/停止/重启服务、打开浏览器、单实例、复用同目录健康服务、日志及启动失败展示。
- Windows 普通 ZIP、含 Python 的便携 ZIP、校验和生成；另有本地自签名构建脚本。
- 文件夹资源同步：识别数据集/报表清单、资源指纹、本机编号、所有者和更新时间，导入时重映射数据集引用；同步来的动态源仍需本机可用连接。

## 3. 技术栈和架构

| 层 | 当前技术 | 职责 |
| --- | --- | --- |
| 浏览器 | React 18.3.1、TypeScript 5.7.3、Vite 5.4.21 | 编辑器、数据管理、设置、只读报表 |
| 图表与布局 | ECharts 6.1.0、react-grid-layout 1.5.4 | 图表选项生成、渲染、拖拽布局 |
| HTTP API | Python、FastAPI、Uvicorn、Pydantic | 校验、导入、报表/数据集 API、发布 |
| 本地分析 | DuckDB、PyArrow、Parquet | 快照存储、筛选、聚合、结果读取 |
| 外部查询 | `ctypes` → `myquery_core.dll`，ABI 版本 2 | 与 MyQuery 共用数据库执行模块 |
| 元数据 | SQLAlchemy；本地 SQLite，服务端可配置 PostgreSQL | 数据集、快照、连接、报表、评论、刷新租约 |
| 导入与安全 | python-calamine、cryptography/Fernet、Windows DPAPI | Excel 读取、数据库内密码加密、共享密码保护 |
| 桌面管理 | Rust edition 2024、Slint 1.18.1、windows-sys | 原生窗口、托盘、Windows 进程和 HTTP 管理 |
| 服务部署 | Docker Compose、PostgreSQL 17、Web 代理、独立 scheduler | 服务端持久化和定时刷新 |

Python 包声明支持 >=3.12；当前 Windows 发布/构建说明使用 Python 3.13 x64。版本精确信息以 `frontend/package-lock.json`、`desktop/Cargo.lock` 和 `backend/pyproject.toml` 为准；Python 依赖多为下限约束，没有等价的完整锁定文件。

主要数据流：

```text
MyBI.exe → Python/Uvicorn → FastAPI API + frontend/dist 静态页面
浏览器 → 导入/动态源预览 → 字段配置 → Parquet 快照 + 元数据库 + 资源清单
图表 → view-query → DuckDB 读取 Parquet 并聚合 → ECharts
动态源 → MyQuery 共享 DLL → 完整结果 → 缓存/不可变快照
后台 scheduler → 刷新租约 → 更新成功快照 → 已打开页面轮询元数据后更新
独立公网监听 → 已发布文档和授权数据查询
```

不要混淆两类查询：外部数据库取数由共享核心负责，图表分析查询由 DuckDB 负责。打开报表和页面轮询不应反复执行外部 SQL。

## 4. 源码导航与修改影响范围

| 任务 | 优先查看 |
| --- | --- |
| 页面、编辑器、接入弹窗和属性栏 | `frontend/src/App.tsx`、`styles.css` |
| 报表文档、布局、页签 | `dashboard.ts`、`ReportTabs.tsx`、`ReportsPage.tsx` |
| 动态接入、连接设置 | `DynamicSource.tsx`、`ConnectionsSettings.tsx` |
| 数据集管理与预览 | `DatasetManager.tsx`、`DatasetPreview.tsx`、`ValueLabelsEditor.tsx` |
| 字段绑定、格式、日期 | `FieldBindings.tsx`、`fieldDisplay.ts`、`dateTime.ts` |
| 图表类型/选项/生命周期 | `frontend/src/charts/registry.ts`、`options.ts`、`ChartView.tsx` |
| 画布筛选 | `FilterControl.tsx`、`Filters.tsx`、`dashboard.ts`，以及后端 ViewQuery |
| 中英文本 | `frontend/src/i18n.ts`、`locales/en.json`；桌面共享词典的使用处 |
| API 启动、鉴权、静态路由、兼容字段迁移 | `backend/app/main.py` |
| 静态导入、字段更新、图表分析查询 | `backend/app/api/datasets.py`、`imports/`、`expressions.py` |
| 动态预览/保存/刷新入口 | `backend/app/api/sources.py` |
| 动态执行、缓存、暂存预览、租约 | `backend/app/dynamic.py`、`query_core.py` |
| 定时刷新 | `backend/app/scheduler.py` |
| 数据库模型与配置 | `models.py`、`db.py`、`settings.py` |
| 报表保存、发布和评论 | `backend/app/api/dashboards.py` |
| 连接共享与对象目录 | `connections.py`、`shared_data.py` |
| 文件清单、原子写入、回滚、文件夹同步 | `storage.py`、`folder_sync.py` |
| 公网配置和只读边界 | `public_access.py`、`PublicAccessSettings.tsx` |
| 桌面服务/托盘 | `desktop/src/main.rs`、`service.rs`、`tray.rs`、`desktop/ui/` |
| 构建与打包 | `scripts/build.ps1`、`package-release.py`、`build-selfsigned.ps1` |

前端表格中的文件名未写前缀时均位于 `frontend/src/`。部分字段配置组件仍定义在 `App.tsx` 内，不要假定每个组件都有独立文件。

跨层修改需一起核对：前端类型/请求 → Pydantic 校验 → 模型/文档 JSON → 清单导出和文件夹导入 → 已发布文档兼容。新增图表配置还需核对字段绑定、查询参数和 ECharts 选项。调用共享函数前用 `rg` 查全部调用方，不要只修一个界面入口。

## 5. 数据、文件与备份

```text
data-workbench.db                       本地元数据
data/secret.key                        本地 Fernet 密钥
data/snapshots/                        历史快照目录，保留兼容
data/logs/                             服务日志
data/public-access.json                公网设置
datasets/<dataset-id>/<fingerprint>.json
datasets/<dataset-id>/snapshots/<snapshot-id>.parquet
datasets/<dataset-id>/cache/YYYY-MM-DD.parquet
datasets/<dataset-id>/cache/YYYY-MM-DD.json
reports/<fingerprint>.json             报表及已发布版本、数据集指纹映射
```

最新清单文件名使用资源 `fingerprint`，兼容旧的 `dataset.json` 和报表 ID 文件名。不要照旧 README 硬编码旧路径，应调用 `dataset_manifest_path()` 和 `report_path()`。UUID、fingerprint、本机 `local_id` 各有用途，不能相互替代。

数据库是正常 API 写入的元数据基础，同时已实现清单扫描导入；文件夹同步不是简单覆盖数据库。清单校验路径、快照和字段，按资源指纹匹配并重映射引用；无效/不完整资源保留本机数据并记日志。复制报表供另一台机器使用时，应一起复制关联数据集及完整快照，密码不会随清单带走。不要运行中手工改清单或只复制一个 JSON 就认为资源完整。

Windows 共享资源在仓库外：

- `%APPDATA%/MyDataTools/connections.json`：连接和浏览范围。
- 同目录 `passwords.dat`：DPAPI 加密的共享密码；旧 SqlDesk/MyQuery 路径有迁移兼容。
- `%LOCALAPPDATA%/MyDataTools/metadata/`：对象和字段缓存。

SQLite 中连接密码用 Fernet 加密，Windows 共享密码另用 DPAPI，备份策略不能混为一谈。DPAPI 文件依赖 Windows 用户环境，不能假设复制到另一台电脑即可解密。禁止把真实密码、密钥、用户数据或日志写进 Git、文档和调试输出。

完整本地备份应包含数据库、`datasets/`、`reports/`、`data/` 中密钥和仍被引用的旧快照；共享连接另按上述位置备份。文件夹导入可恢复资源，但不等价于完整恢复评论、个人资料、连接和全部数据库状态。

## 6. 已遇到的坑与当前边界

以下是现有实现中的兼容/防护点，以及从代码可确认的限制，不把未复现的问题写成已确认故障。

1. **构建成功但界面仍旧。** 运行服务使用 `frontend/dist`，不是 TSX 源码；改前端必须构建。管理器、后台 Python 和已加载 DLL 的进程也要重启。
2. **MyQuery 不是可选的普通源码依赖。** `query_core.py` 要求根目录 DLL 的 ABI 为 2；缺失/不兼容返回 503。构建默认查同级 `../MyQuery/build.ps1`，否则只能复用已有 DLL。共享核心修改需在 MyQuery 工程完成，再复制构建结果。
3. **预览、校验和保存不是同一件事。** `validate` 不保存数据集；`preview` 可暂存完整结果并返回 `preview_id`，保存时可复用匹配的暂存结果。新建无 preview_id 时才重新查询；现有源不带 preview_id 的保存主要更新配置。旧文档“保存必定重查”已不精确。
4. **取消必须到达数据库执行层。** 当前链路是前端中止请求 → 服务端断连检查/Event → DLL 的 cancel 文件；不能只关闭弹窗或忽略响应。临时预览还需释放，避免旧结果覆盖新输入。
5. **日期缓存不是发布快照。** 缓存日期按数据集时区计算；强制刷新覆盖当天缓存，快照保持独立。删缓存不能顺便删发布报表依赖的快照。
6. **动态与静态发布语义不同。** 动态源解析最新成功快照，静态源保留发布快照；打开的动态报表约每 15 秒检查元数据。刷新失败保留旧成功结果并记录错误。
7. **并发与版本不可绕过。** 数据集、报表和连接有版本/冲突处理；刷新用数据库租约。保留事务、原子写文件和失败回滚，避免数据库与文件状态不一致。
8. **删除引用数据集会破坏报表。** 当前删除 API 默认返回 409，并支持 `confirm_references=true` 确认后删除；不是 README 所述永久禁止删除。刷新期间也有删除保护，不能绕过确认和租约检查。
9. **数值格式不能改变数据精度。** 百分比是显示规则；不要保存已四舍五入的展示字符串或重复乘除 100。纯数字表格默认首字段转文本维度、百分比字段名大小写识别等已有兼容逻辑。
10. **图表不是统一一套坐标规则。** 蜡烛图标签使用各自坐标，多指标有独立聚合/轴配置，显示前 X 项需同步类别轴；修改 `options.ts` 时需考虑这些分支。
11. **TLS 与 Redshift。** 默认验证证书和主机名；信任服务器证书是显式选项。共享查询核心对 Redshift typed SQL 语法错误有降级重试，不要简单删除兼容路径。
12. **公网 IP 不等于入站可达。** ipify 仅探测出口地址；不解决 CGNAT、端口转发、DNS 或 HTTPS。8000 是管理端口，8001 是独立只读入口，不要把二者直接互换暴露。
13. **服务端部署说明需重新核实。** 仓库有 Compose/API/scheduler 部署配置，但最新外部取数仍加载 Windows `.dll`，共享密码使用 Windows DPAPI。Linux 容器下这部分不能仅凭配置存在就认定可用，本次未验证。
14. **调度默认值有差异。** Python 默认动态查询超时 3600 秒，Compose 默认 300 秒；配置 API 和 scheduler 时保持一致。服务停机不执行定时刷新，浏览器关闭不影响后台调度。
15. **端口与进程归属。** 管理器校验 health 的项目路径和 PID 后才复用/停止服务，避免误杀别的 Python 服务。不要按进程名批量终止所有 Python。
16. **防火墙和终端防护。** SimpleWall 新放行程序后，必须结束该可执行文件全部实例并重启再测网络；已有进程不适用新规则。自签名不会自动建立系统信任，EXE 构建后消失应检查终端防护。
17. **历史 UI 与现行规则可能不一致。** `App.tsx` 的删除撤销提示仍有“5 秒内可恢复”文本；项目现行规则要求 toast 总计 3 秒并渐隐。后续改相关 UI 应核实实际计时和样式，本次未改行为。
18. **依赖声明不代表迁移体系完备。** 虽依赖 Alembic，当前启动仍有 `create_all` 和手工补字段逻辑；不要假设新增 ORM 列能自动迁移旧库。服务端首次建表先用单 API 进程。

## 7. 开发、构建和交付

在根目录 PowerShell 操作。首次环境准备：

```powershell
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install ./backend
npm.cmd --prefix frontend ci
```

需要 Node.js、Rust `stable-x86_64-pc-windows-gnu`、LLVM-MinGW 和对应共享核心。完整构建：

```powershell
.\scripts\build.ps1 -LlvmBin <LLVM-MinGW-bin>
# 需要打包时添加 -Package；默认同级 MyQuery，可用 -MyQueryRoot 指定。
```

构建脚本先构建前端，停止本项目 MyBI/后端进程，构建或复用共享核心，再构建 Rust 管理器并覆盖根目录 `MyBI.exe`。它不自动启动应用，也不运行测试。打包产物放在 `artifacts/`，应使用脚本排除个人数据。

开发时可分别运行（两个终端）：

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
npm.cmd --prefix frontend run dev
```

Vite 严格使用 5173 并将 `/api` 代理至 8000。直接使用 8000 的生产页面需要先有 `frontend/dist`；API 在启动时决定是否挂载静态目录，首次构建后需重启。

配置入口为 `backend/app/settings.py` 和环境变量：本地默认 SQLite、100 MiB 输入限制、图表结果最多 10000 行、图表查询超时 30 秒、并发 2；动态取数默认最多 1000000 行、超时 3600 秒。`.env.example` 不是完整配置清单，不要假设本地启动会自动加载它。

测试设施已存在：`frontend/src/**/*.test.*`（Vitest）、`backend/tests/`（pytest）、`tests/browser_*.py`（浏览器流程）及 `tests/launcher.test.ps1`。**用户未明确要求时禁止运行测试。** 构建与测试是两件事；需要测试时再按具体任务选范围，不把历史测试报告当成当前验证结果。

## 8. 所有 agent 必须遵守的协作规则

- 直接在 `main` 工作，不创建、切换或使用功能/发布分支；先看工作区状态，保留用户已有改动。
- 不运行未获明确要求的测试。完成可运行项目的代码改动后，按需构建，结束已有项目进程，覆盖并启动同一个 `D:\Dev\MyBI\MyBI.exe` 供用户试用；不生成额外预览 EXE。纯文档修改无需构建或重启。
- Git 元数据写入按当前沙箱权限执行，不能修改 NTFS ACL 绕过。GitHub 认证异常先核对普通 Windows 用户的已有 keyring 凭据，避免重复登录；真正认证变更后执行 `gh auth setup-git` 和 `gh auth status`。
- UI 复用已有颜色、字体、尺寸、边框、圆角、间距和交互状态，包含图表内控件。按钮紧凑、按标签定宽，同类行操作等宽对齐。
- 所有新增/变更 UI 文本走共享中英本地化；中文源文本配 `locales/en.json`，不要翻译用户数据、字段名和报表标题。
- 术语固定：第二侧栏是工具栏，右侧栏是属性侧栏。筛选从工具栏添加到画布，选中后在属性侧栏配置。
- 筛选只允许画布筛选控件，禁用旧的隐式筛选条件和每图表筛选模式。仅文字/日期维度可作筛选字段，级联默认值和旧文档恢复也遵守。
- 数字显示不损失原值/计算精度；整数 0 位，小数/默认小数设置 1–8 位。所有数据列表每页 10 行。
- toast 总时长 3 秒，消失前渐隐。若发现历史实现冲突，在相关任务中处理，不顺带扩大无关改动。
- 用现有组件、存储 helper、校验和本地化模块，优先最小完整修改；不顺手重写大文件、增加依赖或创建抽象层。
- Git 同步最新构建的 `MyBI.exe`、`myquery_core.dll` 和 `frontend/dist`（每次构建后一并提交）；不同步密码与密钥（`data/secret.key`、`.env`、含加密密码的数据库）、运行时、依赖和构建缓存。换电脑拉取后仍需安装 Python 依赖，用户资源另外备份/同步。
- 定时查询：设置 → 定时查询，维护按计划执行的 SQL（规则同动态数据集，仅已保存连接），可启用/停用、立即执行，记录上次执行时间、耗时、行数和错误；入口 `backend/app/api/scheduled_queries.py`、`frontend/src/ScheduledQueries.tsx`，由 `scheduler.py` 调度。

## 9. 文档维护

后续完成影响功能、架构、数据兼容、构建或排障的修改时，同步更新本文件。把“源码存在”“已构建”“已测试”“用户已验收”分开记录；新增已知问题应给出代码入口和实际证据。不要写入密钥、连接密码或真实业务数据。

本次只整理文档，未运行测试、构建、启动应用或验证容器/公网部署；运行时状态及各图表实际表现仍以对应环境验证为准。
