# 农业电商智能咨询与本地 RAG

项目需求源于我此前参与蔬菜业务网站、小程序及真人在线客服时观察到的咨询场景。这是独立开发的技术原型。

当前版本以 SQLite 查询商品事实，以本地中英文词法检索提供农业知识、保存说明和公开客服 FAQ 的证据。商品名称及别名用于识别商品；有效日期、规格、价格与可售状态由目录决定。知识与政策按商品、问题类型和有效期隔离。混合问题分别处理事实与证据，再合并答案。资料不足、过期价格和未确认政策会明确降级。

可选模型通过兼容 Chat Completions 的流式接口组织证据顺序；模型仅返回证据 ID 的排列。服务器验证排列后，使用目录事实和证据原文组装答案，模型生成的价格、规格或其他自由文本不会展示。无证据或纯目录问题不请求模型；其他正常模型请求只检索一次、调用 provider 一次，无自动重试。

这是词法检索式 RAG 原型，尚未实现向量检索、自由生成答案、正式领域评估或生产部署。API 默认仅监听本机，无账号系统、限流或订单交易能力。

## 运行

需要 Node.js 24（使用内置 `node:sqlite`，无 npm 运行依赖）。无需下载模型或安装 npm 包即可运行：

```sh
npm test
npm run check
npm run evaluate
npm start
```

默认数据目录为空。服务仍可启动，首次启动在本地创建 `data/catalog.sqlite`，咨询返回“资料不足”或“政策未确认”，不会联网。数据库、真实本地数据、日志和密钥不会被 Git 跟踪。

## API

- `GET /health`：启动检查和许可证标识。
- `POST /ask`：JSON 回答。
- `POST /ask/stream`：SSE 事件 `meta`、`progress`、`answer`、`done`；无资料请求没有模型进度事件。

请求体示例（商品为虚构测试商品）：

```json
{"question":"西红柿多少钱及怎么保存","asOf":"2030-06-01"}
```

`asOf` 可选，默认 UTC 当天；它表示查询时点，不证明该日真实库存。响应包含 `route`、`mode`、目录版本、证据来源、有效期及本次调用计数。SSE 中模型的 JSON 流先缓存并校验，只发送整理进度；完成后分段发送可信答案。它不把未经验证的模型 token 直接输出。模型超时或失败保留本地证据回答；客户端断开连接会取消 provider 与读取流。

## 数据边界及导入

公开 `data/catalog/` 与 `data/knowledge/` 仅有 `.gitkeep`。`test/fixtures/` 的全部商品、价格、保存文本和政策都明确标为虚构，仅用于回归测试，不能用于真实客服。仓库不包含真实客户、订单、合同、公司政策、客服记录或个人知识资料。

本地目录导入和知识导入命令：

```sh
npm run import -- catalog path/to/authorized-catalog.json
npm run import -- knowledge path/to/authorized-knowledge.json
```

导入前需自行确认内容可用于本地处理。目录 JSON 导入 SQLite；知识 JSON 验证后保存到被忽略的知识目录。导入会拒绝日期重叠、别名冲突、悬空商品 ID 和重复知识 ID，失败不替换现有数据。新增版本可使用空的 `products` 数组引用已存在的商品。版本与名称不支持覆盖更新。

本机虚构演示可执行以下命令，指定示例时点才能匹配夹具有效期：

```sh
npm run import -- catalog test/fixtures/catalog.json
npm run import -- knowledge test/fixtures/knowledge.json
npm start
```

数据格式、有效日期规则和无数据行为详见 [数据说明](docs/data-format.md)。模型配置通过进程环境变量设置，字段见 `.env.example`；程序不自动读取 `.env`。未配置时只使用本地确定性答案。若仅配置部分模型字段，启动失败并给出固定错误提示。

## 验证及限制

离线测试使用 provider/fetch stub，禁止外部 HTTP 和 fetch，仅 HTTP 集成测试使用本机回环连接。24 个虚构咨询案例的评估方法、23/24 基线及英文语料缺口见 [合成案例评估](docs/domain-evaluation.md)；这些案例不能代表真实领域准确率。验证结果及独立基准见 [验收记录](docs/validation.md)，简历措辞见 [项目描述](docs/resume-description.md)。

已移除桌面、录屏、音频、转写、个人 Profile、时间线、快捷键与窗口功能。本版未提供演示页面，以 HTTP API 为最小接口。敏感字段与路径检测是有限的技术防护，不能替代业务资料授权确认、人工脱敏或正式隐私审计。

本项目采用 GPL-3.0-only，修改与第三方作者声明见 [许可声明](THIRD_PARTY_NOTICES.md)。无担保；发布源码时需保留 LICENSE 和作者声明。
