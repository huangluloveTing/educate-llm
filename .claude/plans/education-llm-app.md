# 教育类大模型应用（课题报告生成 + RAG）实现计划

## 目标与范围（MVP + 可扩展）
在当前空目录中创建一个可运行的 **Monorepo** 项目：
- **后端**：TypeScript + Node.js + LangChain
- **前端**：TypeScript + React + Vite + Ant Design
- **核心能力**：
  1) 知识库搭建（创建/管理知识库、分块与向量化、检索）
  2) 文档上传与解析（PDF / DOCX / HTML/Markdown / TXT）
  3) 任务编排（面向“课题报告生成”的可配置流程：检索→大纲→分章生成→汇总→导出）
  4) 聊天（支持选择知识库的 RAG Chat，SSE 流式输出）
  5) 报告生成（SSE 流式生成草稿；最终可导出 PDF）
  6) 鉴权与权限（JWT + RBAC：管理员/老师）
  7) 审计与可观测（基础日志、任务与文档操作记录）

已确认偏好：
- LLM：**OpenAI 兼容 Provider**（baseURL + apiKey + model 走配置）
- 向量库：**Qdrant**
- 元数据 DB：**Postgres + Prisma**
- 文件存储：**本地磁盘**
- 生成输出：**PDF**
- 交互：**SSE 流式**
- 包管理：**pnpm**
- UI：**Ant Design**
- 语言：**中文**

---

## 总体架构

### 目录结构（Monorepo）
- `apps/api`：后端服务（REST + SSE）
- `apps/web`：前端应用（Vite + React）
- `packages/shared`：共享类型与 zod schema（可选但推荐）
- `infra/`：docker-compose（Postgres + Qdrant）
- `storage/`：本地文件存储（上传原文件、解析中间产物、生成的 PDF）

### 运行时组件
- **API 服务**
  - 鉴权：JWT
  - RBAC：管理员/老师
  - 文档入库：解析 → chunk → embedding → upsert 到 Qdrant
  - RAG：retriever + prompt + LLM（流式）
  - 报告生成：编排器（多步）+ SSE 推送进度与 token
- **Postgres（Prisma）**
  - users / roles
  - knowledge_bases
  - documents（元数据、状态、来源、hash、所属 KB）
  - document_chunks（可选：只存 chunk 元信息；向量在 Qdrant）
  - report_jobs / report_sections（生成任务与分章草稿）
  - audit_logs
- **Qdrant**
  - collection = knowledgeBaseId
  - point payload：documentId、chunkIndex、source、page、title 等

---

## 功能拆解与 API 设计（MVP）

### 1) 鉴权与用户
- `POST /auth/login`（用户名/密码 → JWT）
- `GET /auth/me`
- RBAC：
  - Admin：管理用户、知识库、文档
  - Teacher：使用知识库检索、聊天、生成报告

### 2) 知识库管理
- `POST /kb`（Admin）创建知识库
- `GET /kb`（Admin/Teacher）列出可见知识库
- `GET /kb/:id`
- `PATCH /kb/:id`
- `DELETE /kb/:id`

### 3) 文档上传与入库
- `POST /kb/:id/documents/upload`（multipart）
  - 保存原文件到 `storage/uploads/<kbId>/...`
  - 记录 DB 状态：uploaded → parsing → embedding → ready/failed
- `GET /kb/:id/documents`
- `GET /documents/:id`（状态/元信息）
- `DELETE /documents/:id`

解析与分块策略（默认）：
- PDF：提取文本（逐页），保留页码
- DOCX：提取段落
- HTML/MD：去标签或按 block
- TXT：按段落
- Chunk：递归字符/Token splitter，chunkSize + overlap 可配置

### 4) 检索（用于调试与透明度）
- `POST /kb/:id/search`：输入 query → 返回 topK chunks（含来源、页码等）

### 5) 聊天（RAG Chat）
- `POST /chat/stream`（SSE）
  - body: { kbId, messages[], retrieval: { topK, scoreThreshold? } }
  - SSE event：token、sources、done、error

### 6) 课题报告生成（任务编排 + SSE）
- `POST /reports/stream`（SSE）
  - 输入：课题名称、学段/学科、研究周期、研究问题、约束等
  - 流程（可配置）：
    1) 从 KB 检索：按章节主题分多次 retrieval
    2) 生成大纲（章节结构）
    3) 分章生成（每章独立 prompt + 引用 sources）
    4) 汇总与格式化（Markdown）
    5) 生成 PDF（markdown → pdf）并落盘
  - 产物：
    - 实时 SSE：进度 + token
    - DB：report_job 状态、sections 草稿
    - 文件：`storage/reports/<jobId>.pdf`

- `GET /reports/:jobId`（元信息 + 下载链接）
- `GET /reports/:jobId/download`（下载 PDF）

---

## LangChain 关键实现点

### LLM（OpenAI 兼容）
- 通过环境变量配置：
  - `LLM_BASE_URL`
  - `LLM_API_KEY`
  - `LLM_MODEL`
- 使用 LangChain 的 OpenAI-compatible ChatModel（或官方 OpenAI SDK + LangChain adapter）

### Embeddings
- 同样走 OpenAI 兼容 embeddings（若 provider 支持），否则允许单独配置 embeddings provider。

### Retriever
- QdrantVectorStore + metadata filters（documentId / kbId）
- 返回 sources（标题/页码/片段）用于引用。

### Prompt（中文）
- Chat：系统提示 + 引用要求（必须标注来源）
- 报告：分章节模板化 prompt，要求：
  - 结构清晰（一级/二级标题）
  - 给出可落地的研究过程与评价方式
  - 引用检索到的资料（sources）

---

## 前端页面规划（AntD）

### 路由
- `/login`
- `/kb` 知识库列表
- `/kb/:id/documents` 文档管理与上传
- `/chat` RAG Chat（选择知识库）
- `/reports/new` 新建报告生成（表单）
- `/reports/:id` 查看生成结果 + 下载 PDF
- `/admin/users`（可选：MVP 可先不做 UI，先做 API）

### 关键交互
- 文档上传：显示处理状态（uploaded/parsing/embedding/ready/failed）
- Chat：SSE 流式输出，右侧展示 sources
- 报告生成：
  - SSE 流式：显示“步骤进度条 + 实时草稿”
  - 完成后显示 PDF 预览（iframe）与下载按钮

---

## 基础设施与本地开发

### docker-compose（infra/docker-compose.yml）
- Postgres
- Qdrant

### 启动脚本
- `pnpm dev`：并行启动 web + api
- `pnpm db:migrate`：Prisma migrate

---

## 关键数据模型（Prisma 草案）
- User { id, username, passwordHash, role }
- KnowledgeBase { id, name, description, visibility }
- Document { id, kbId, filename, mime, storagePath, status, hash, createdBy }
- ReportJob { id, kbId, createdBy, topic, status, outputPdfPath, createdAt }
- ReportSection { id, jobId, title, order, markdown }
- AuditLog { id, actorId, action, targetType, targetId, metaJson, createdAt }

---

## 里程碑（按实现顺序）

1) Monorepo 初始化（pnpm workspace）+ Web/API 基础跑通
2) Docker infra：Postgres + Qdrant
3) Prisma schema + migrate + seed（管理员）
4) Auth（JWT）+ RBAC 中间件
5) KB CRUD
6) 文档上传（本地存储）+ 解析 + chunk + embedding + Qdrant upsert
7) 检索 API（search）
8) Chat SSE（RAG）
9) 报告生成编排 + SSE
10) Markdown → PDF 导出与下载
11) 审计日志与基础运维（healthcheck、日志）

---

## 验收/测试清单
- 能创建知识库
- 能上传 PDF/DOCX/TXT/MD 并完成入库
- `/search` 返回合理 chunks 与来源
- Chat 能选择 KB 并流式回答，展示 sources
- 报告生成能流式输出草稿，完成后可下载 PDF
- 登录/权限：老师不能做管理员操作

---

## 需要你确认的少量细节（若不确认则用默认）
- 报告模板字段：课题类型（开题/中期/结题）是否要区分？默认：结题报告
- 用户体系：是否需要“学校/组织”多租户？默认：不需要（单租户）
- 文档权限：教师是否只能访问自己上传的文档？默认：按知识库授权（同一 KB 内共享）
