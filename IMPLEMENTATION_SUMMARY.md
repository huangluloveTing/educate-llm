# Implementation Summary: Chat SSE + Report Generation SSE + PDF Export

## Status: Complete ✅

All requested features have been successfully implemented and verified.

**最新更新 (2026-03-20)**:
- ✅ 所有后端错误信息和 LLM prompt 中文化
- ✅ 报告大纲从 5 章英文改为 7 章中文教育课题结题报告标准章节
- ✅ 所有前端 UI 文案中文化
- ✅ 修复前端 API 调用问题（VITE_API_BASE_URL + accessToken）

## Files Modified/Created

### Backend Files

1. **apps/api/src/api/documents/index.ts** - Unified documents API
   - Handles all document operations with proper routing
   - Routes: GET/POST /kb/:kbId/documents, GET/DELETE /documents/:id, POST /kb/:kbId/search
   - Storage: STORAGE_DIR/uploads/<kbId>/<documentId>/<originalName>
   - Deletion removes both Qdrant points and file storage

2. **apps/api/src/api/chat/index.ts** - Chat SSE endpoint (NEW)
   - POST /api/v1/chat/stream (SSE)
   - Retrieves context from Qdrant, sends sources first, then streams LLM response
   - Validates LLM_API_KEY configuration
   - **✅ 中文化**: 所有错误信息和系统 prompt 改为中文

3. **apps/api/src/api/reports/index.ts** - Report generation SSE + PDF (NEW)
   - POST /api/v1/reports/stream (SSE) - Generate report with streaming sections
   - GET /api/v1/reports/:id - Get report details
   - GET /api/v1/reports/:id/download - Download PDF
   - **✅ 7 章中文大纲**:
     1. 研究背景与意义
     2. 文献综述
     3. 研究方法
     4. 研究过程与实施
     5. 研究结果与分析
     6. 研究结论与建议
     7. 研究反思与展望
   - **✅ 中文化**: 所有错误信息和 LLM prompt 改为中文
   - PDF generation with optional custom font support (PDF_FONT_PATH)

4. **apps/api/src/api/index.ts** - Router configuration
   - Mounts chat and reports routers
   - All routes properly configured

5. **apps/api/src/utils/sse.ts** - SSE utilities (EXISTING)
   - Proper SSE headers and event formatting

6. **apps/api/src/llm/chatModel.ts** - LLM model factory (EXISTING)
   - Creates ChatOpenAI instances with configured settings

7. **apps/api/src/env.ts** - Environment configuration (EXISTING)
   - LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
   - PDF_FONT_PATH (optional)
   - STORAGE_DIR

### Frontend Files

1. **apps/web/src/pages/ChatPage.tsx** - Chat interface with SSE
   - Knowledge base selector
   - Message history display
   - SSE streaming with proper event parsing (FIXED parsing bug)
   - Source citation display
   - **✅ 中文化**: 所有 UI 文案改为中文
   - **✅ 修复 API 调用**: 使用 VITE_API_BASE_URL 和 accessToken

2. **apps/web/src/pages/NewReportPage.tsx** - Report generation interface
   - Form with required/optional fields (kbId, topic, gradeLevel, subject, etc.)
   - Progress indicator during generation (7 sections total)
   - Real-time section display as markdown cards
   - PDF download button
   - SSE streaming with proper event parsing (FIXED parsing bug)
   - **✅ 中文化**: 所有 UI 文案改为中文
   - **✅ 修复 API 调用**: 使用 VITE_API_BASE_URL 和 accessToken
   - **✅ 更新章节总数**: 从 5 改为 7

### Database Schema (EXISTING in prisma/schema.prisma)

- `ReportJob` model: id, kbId, topic, status, outputPdfPath, createdById
- `ReportSection` model: id, jobId, title, order, markdown
- `ReportStatus` enum: RUNNING, SUCCEEDED, FAILED

## Key Features Implemented

### A) Chat SSE (RAG Dialogue)

**Backend: POST /api/v1/chat/stream**
- Request body: `{ kbId: string, messages: [{role, content}], retrieval?: {topK?: number} }`
- Flow:
  1. Embeds last user message
  2. Searches Qdrant collection kb_<kbId>
  3. Sends SSE event:sources with search results
  4. Streams LLM response as event:token
  5. Sends event:done when complete
- Error handling: Returns SSE event:error if LLM_API_KEY missing or other errors

**Frontend: ChatPage.tsx**
- Dropdown to select knowledge base
- Message input with send button
- Real-time streaming display of assistant responses
- Source citations shown below conversation
- Uses fetch() + ReadableStream to parse SSE (not EventSource, as POST is required)

### B) Report Generation SSE + PDF

**Backend: POST /api/v1/reports/stream**
- Request body: `{ kbId, topic, gradeLevel?, subject?, researchDuration?, researchQuestions? }`
- Flow:
  1. Creates ReportJob with status=RUNNING
  2. For each of 7 sections (中文教育课题结题报告标准章节):
     - Retrieves relevant context from Qdrant (topK=5)
     - Generates section content with LLM (Chinese prompt)
     - Saves to database
     - Sends SSE event:section with markdown
  3. Generates PDF using pdfkit + marked
  4. Saves to STORAGE_DIR/reports/<jobId>.pdf
  5. Updates ReportJob with status=SUCCEEDED
  6. Sends SSE event:done with reportId and downloadUrl

**PDF Generation:**
- Uses pdfkit for PDF creation
- Converts markdown to plain text using marked + HTML tag stripping
- Supports custom font via PDF_FONT_PATH environment variable
- Falls back to Helvetica if no custom font provided

**Frontend: NewReportPage.tsx**
- Form with knowledge base selector, topic (required), and optional fields (Chinese labels)
- Progress bar during generation (0-100% based on 7 sections)
- Real-time display of generated sections as cards with markdown rendering
- Download PDF button appears when complete (opens in new tab)

### C) Documents Route Unification (FIXED)

**Issue:** Two conflicting route implementations
- apps/api/src/api/kb/documents.ts (unused)
- apps/api/src/api/documents/index.ts (active)

**Solution:** Kept documents/index.ts as the single source of truth
- All routes properly match frontend expectations
- Storage path: STORAGE_DIR/uploads/<kbId>/<documentId>/<originalName>
- Deletion removes both Qdrant vectors and file storage
- Uses existing services (embeddings, ingestion, qdrant)

### D) Bug Fixes

1. **SSE Parsing Bug (CRITICAL FIX)**
   - Both ChatPage and NewReportPage had incorrect SSE parsing logic
   - Used `lines.shift()` during iteration which skipped events
   - Fixed by using indexed for-loop with proper increment

2. **No duplicate navigate issue found in KbListPage**
   - Verified only one `useNavigate()` declaration exists

3. **前端 API 调用错误 (CRITICAL FIX)**
   - ChatPage 和 NewReportPage 使用了错误的环境变量 `VITE_API_URL`
   - 应该使用 `VITE_API_BASE_URL`（已在 .env 中配置为 `http://localhost:3001/api/v1`）
   - Token 键名错误：使用了 `"token"` 应该是 `"accessToken"`

4. **中文化 (LOCALIZATION)**
   - 所有后端错误信息从英文改为中文
   - 所有 LLM system prompt 从英文改为中文
   - 所有前端 UI 文案从英文改为中文

5. **报告章节大纲更新**
   - 从 5 章英文大纲改为 7 章中文教育课题结题报告标准章节
   - 前端 totalSections 从 5 更新为 7

## Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/edudb
JWT_SECRET=your-secret-key

# LLM Configuration
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4.1-mini

# Embeddings (optional, uses LLM config if not set)
EMBED_BASE_URL=https://api.openai.com/v1
EMBED_API_KEY=sk-...
EMBED_MODEL=text-embedding-3-small

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=optional-key

# Storage
STORAGE_DIR=../../storage
PDF_FONT_PATH=/path/to/custom/font.ttf  # Optional for non-English PDFs
```

## Testing Instructions

### Prerequisites

1. Start services:
```bash
docker-compose up -d  # Starts PostgreSQL and Qdrant
```

2. Set up database:
```bash
cd apps/api
pnpm prisma migrate dev
pnpm prisma db seed  # Creates admin user
```

3. Configure environment:
```bash
# Create .env file with all required variables
cp .env.example .env
# Edit .env and set LLM_API_KEY and other variables
```

### Test Chat SSE

```bash
# 1. Start backend
cd apps/api
pnpm dev

# 2. In another terminal, start frontend
cd apps/web
pnpm dev

# 3. In browser:
# - Login as admin (username: admin, password from seed)
# - Create a knowledge base
# - Upload some documents
# - Wait for documents to be indexed (status: READY)
# - Go to Chat page
# - Select the knowledge base
# - Send a message
# - Verify sources appear and response streams in real-time

# 4. Test via curl:
curl -X POST http://localhost:3001/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "kbId": "KB_ID_HERE",
    "messages": [{"role": "user", "content": "What is project-based learning?"}],
    "retrieval": {"topK": 5}
  }'

# Expected SSE output:
# event: sources
# data: {"sources":[{...}]}
#
# event: token
# data: {"content":"Project-based"}
#
# event: token
# data: {"content":" learning"}
# ...
# event: done
# data: {}
```

### Test Report Generation SSE + PDF

```bash
# 1. Via frontend:
# - Go to New Report page
# - Select a knowledge base
# - Enter topic: "Project-Based Learning in STEM Education"
# - Optionally fill in grade level, subject, etc.
# - Click Generate Report
# - Watch sections appear in real-time
# - Click Download PDF when complete

# 2. Test via curl:
curl -X POST http://localhost:3001/api/v1/reports/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "kbId": "KB_ID_HERE",
    "topic": "Project-Based Learning in STEM Education",
    "gradeLevel": "High School",
    "subject": "Science"
  }'

# Expected SSE output:
# event: section
# data: {"title":"Research Background and Significance","order":1,"markdown":"## Background\n..."}
#
# event: section
# data: {"title":"Literature Review","order":2,"markdown":"..."}
# ...
# event: done
# data: {"reportId":"REPORT_ID","downloadUrl":"/api/v1/reports/REPORT_ID/download"}

# 3. Download PDF:
curl -X GET http://localhost:3001/api/v1/reports/REPORT_ID/download \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  --output report.pdf

# 4. Get report details:
curl -X GET http://localhost:3001/api/v1/reports/REPORT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Test Documents API

```bash
# List documents in KB
curl -X GET http://localhost:3001/api/v1/kb/KB_ID/documents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Upload document
curl -X POST http://localhost:3001/api/v1/kb/KB_ID/documents/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/document.pdf"

# Search in KB
curl -X POST http://localhost:3001/api/v1/kb/KB_ID/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"query": "project-based learning", "topK": 5}'

# Delete document
curl -X DELETE http://localhost:3001/api/v1/documents/DOCUMENT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Build Verification

Both frontend and backend have been verified to compile successfully:

```bash
# Backend build
cd apps/api
pnpm build  # ✓ Success

# Frontend build
cd apps/web
pnpm build  # ✓ Success
```

## Architecture Notes

### SSE Implementation
- Uses proper SSE headers: `text/event-stream`, `no-cache`, `keep-alive`
- Event format: `event: <name>\ndata: <json>\n\n`
- Initial `:ok\n\n` sent to prevent proxy buffering

### Error Handling
- All errors return `{message: string}` format
- SSE errors sent as `event: error` instead of HTTP errors
- LLM_API_KEY validation happens before processing

### Storage Structure
```
storage/
├── uploads/
│   └── <kbId>/
│       └── <documentId>/
│           └── <originalFilename>
└── reports/
    └── <jobId>.pdf
```

## Security Notes

- All endpoints require authentication via JWT token
- Chat and Report generation require ADMIN or TEACHER role
- Document upload requires ADMIN or TEACHER role
- File uploads limited to 50MB
- PDF generation strips HTML to prevent XSS

## Known Limitations

1. **PDF 中文字体支持不完整**
   - 当前使用 PDFKit 默认 Helvetica 字体，不支持中文字符
   - 中文内容在 PDF 中会显示为乱码或空白
   - **解决方案**: 需要配置 `PDF_FONT_PATH` 环境变量指向支持中文的字体文件（如思源黑体）
   - 或考虑使用 Puppeteer + HTML to PDF 方案

2. PDF generation is basic (plain text from markdown)
   - Future: Could use more advanced PDF libraries for better formatting

3. Fixed 7-section outline for reports (MVP)
   - Future: Could make outline customizable

4. No progress indication for individual section generation
   - Future: Could add token-level streaming for sections

5. No ability to cancel ongoing report generation
   - Future: Could add cancellation support

## Next Steps (Not Implemented)

- Real-time collaboration on reports
- Report templates library
- Advanced PDF formatting with images and tables
- Report version history
- Export to other formats (Word, HTML)

---

## 中文 curl 测试示例

### 1. 注册教师账号
```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "teacher1",
    "password": "password123",
    "role": "TEACHER"
  }'
```

### 2. 登录获取 token
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "teacher1",
    "password": "password123"
  }'

# 响应示例:
# {"accessToken":"eyJhbGciOiJIUzI1NiIs..."}
```

### 3. 创建知识库
```bash
export TOKEN="your-access-token-here"

curl -X POST http://localhost:3001/api/v1/kb \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "STEM教育研究",
    "description": "关于STEM教育的研究文献"
  }'

# 响应示例:
# {"id":"cm...","name":"STEM教育研究","description":"关于STEM教育的研究文献",...}
```

### 4. 上传文档
```bash
export KB_ID="your-kb-id-here"

curl -X POST http://localhost:3001/api/v1/kb/$KB_ID/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/教育文献.pdf"

# 响应示例:
# {"documentId":"cm...","status":"UPLOADED"}
# 后台会自动触发入库流程，文档状态会变为 PROCESSING -> READY
```

### 5. 查看文档列表
```bash
curl http://localhost:3001/api/v1/kb/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Chat SSE 测试（中文对话）
```bash
curl -N http://localhost:3001/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kbId": "'"$KB_ID"'",
    "messages": [
      {"role": "user", "content": "什么是项目式学习？"}
    ],
    "retrieval": {"topK": 5}
  }'

# SSE 响应流:
# :ok
#
# event: sources
# data: {"sources":[{"score":0.95,"filename":"教育文献.pdf","documentId":"...","chunkIndex":0,"text":"项目式学习是..."}]}
#
# event: token
# data: {"content":"项目"}
#
# event: token
# data: {"content":"式学习"}
#
# event: token
# data: {"content":"（Project-Based Learning，简称PBL）"}
#
# ...
#
# event: done
# data: {}
```

### 7. 报告生成 SSE 测试（7章中文报告）
```bash
curl -N http://localhost:3001/api/v1/reports/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kbId": "'"$KB_ID"'",
    "topic": "STEM教育中的项目式学习研究",
    "gradeLevel": "高中",
    "subject": "综合实践",
    "researchDuration": "一学年",
    "researchQuestions": "如何通过项目式学习提升学生的创新能力和团队协作能力？"
  }'

# SSE 响应流（7个章节）:
# :ok
#
# event: section
# data: {"title":"研究背景与意义","order":1,"markdown":"## 研究背景与意义\n\n在当今快速发展的科技时代..."}
#
# event: section
# data: {"title":"文献综述","order":2,"markdown":"## 文献综述\n\n关于项目式学习的研究..."}
#
# event: section
# data: {"title":"研究方法","order":3,"markdown":"## 研究方法\n\n本研究采用..."}
#
# event: section
# data: {"title":"研究过程与实施","order":4,"markdown":"## 研究过程与实施\n\n研究分为以下几个阶段..."}
#
# event: section
# data: {"title":"研究结果与分析","order":5,"markdown":"## 研究结果与分析\n\n通过数据收集和分析..."}
#
# event: section
# data: {"title":"研究结论与建议","order":6,"markdown":"## 研究结论与建议\n\n本研究得出以下结论..."}
#
# event: section
# data: {"title":"研究反思与展望","order":7,"markdown":"## 研究反思与展望\n\n在研究过程中..."}
#
# event: done
# data: {"reportId":"cm...","downloadUrl":"/api/v1/reports/cm.../download"}
```

### 8. 下载 PDF 报告
```bash
export REPORT_ID="your-report-id-here"

curl -o 课题结题报告.pdf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/reports/$REPORT_ID/download

# 注意: 当前 PDF 不支持中文字体，需要配置 PDF_FONT_PATH 环境变量
```

### 9. 查看报告详情
```bash
curl http://localhost:3001/api/v1/reports/$REPORT_ID \
  -H "Authorization: Bearer $TOKEN" | jq .

# 响应包含所有 7 个章节的 markdown 内容
```

### 10. 知识库搜索测试
```bash
curl -X POST http://localhost:3001/api/v1/kb/$KB_ID/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "query": "项目式学习的实施步骤",
    "topK": 5
  }'
```

---

## 中文 curl 测试示例

### 1. 注册教师账号
```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "teacher1",
    "password": "password123",
    "role": "TEACHER"
  }'
```

### 2. 登录获取 token
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "teacher1",
    "password": "password123"
  }'

# 响应示例:
# {"accessToken":"eyJhbGciOiJIUzI1NiIs..."}
```

### 3. 创建知识库
```bash
export TOKEN="your-access-token-here"

curl -X POST http://localhost:3001/api/v1/kb \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "STEM教育研究",
    "description": "关于STEM教育的研究文献"
  }'

# 响应示例:
# {"id":"cm...","name":"STEM教育研究","description":"关于STEM教育的研究文献",...}
```

### 4. 上传文档
```bash
export KB_ID="your-kb-id-here"

curl -X POST http://localhost:3001/api/v1/kb/$KB_ID/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/教育文献.pdf"

# 响应示例:
# {"documentId":"cm...","status":"UPLOADED"}
# 后台会自动触发入库流程，文档状态会变为 PROCESSING -> READY
```

### 5. 查看文档列表
```bash
curl http://localhost:3001/api/v1/kb/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Chat SSE 测试（中文对话）
```bash
curl -N http://localhost:3001/api/v1/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kbId": "'"$KB_ID"'",
    "messages": [
      {"role": "user", "content": "什么是项目式学习？"}
    ],
    "retrieval": {"topK": 5}
  }'

# SSE 响应流:
# :ok
#
# event: sources
# data: {"sources":[{"score":0.95,"filename":"教育文献.pdf","documentId":"...","chunkIndex":0,"text":"项目式学习是..."}]}
#
# event: token
# data: {"content":"项目"}
#
# event: token
# data: {"content":"式学习"}
#
# event: token
# data: {"content":"（Project-Based Learning，简称PBL）"}
#
# ...
#
# event: done
# data: {}
```

### 7. 报告生成 SSE 测试（7章中文报告）
```bash
curl -N http://localhost:3001/api/v1/reports/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kbId": "'"$KB_ID"'",
    "topic": "STEM教育中的项目式学习研究",
    "gradeLevel": "高中",
    "subject": "综合实践",
    "researchDuration": "一学年",
    "researchQuestions": "如何通过项目式学习提升学生的创新能力和团队协作能力？"
  }'

# SSE 响应流（7个章节）:
# :ok
#
# event: section
# data: {"title":"研究背景与意义","order":1,"markdown":"## 研究背景与意义\n\n在当今快速发展的科技时代..."}
#
# event: section
# data: {"title":"文献综述","order":2,"markdown":"## 文献综述\n\n关于项目式学习的研究..."}
#
# event: section
# data: {"title":"研究方法","order":3,"markdown":"## 研究方法\n\n本研究采用..."}
#
# event: section
# data: {"title":"研究过程与实施","order":4,"markdown":"## 研究过程与实施\n\n研究分为以下几个阶段..."}
#
# event: section
# data: {"title":"研究结果与分析","order":5,"markdown":"## 研究结果与分析\n\n通过数据收集和分析..."}
#
# event: section
# data: {"title":"研究结论与建议","order":6,"markdown":"## 研究结论与建议\n\n本研究得出以下结论..."}
#
# event: section
# data: {"title":"研究反思与展望","order":7,"markdown":"## 研究反思与展望\n\n在研究过程中..."}
#
# event: done
# data: {"reportId":"cm...","downloadUrl":"/api/v1/reports/cm.../download"}
```

### 8. 下载 PDF 报告
```bash
export REPORT_ID="your-report-id-here"

curl -o 课题结题报告.pdf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/v1/reports/$REPORT_ID/download

# 注意: 当前 PDF 不支持中文字体，需要配置 PDF_FONT_PATH 环境变量
```

### 9. 查看报告详情
```bash
curl http://localhost:3001/api/v1/reports/$REPORT_ID \
  -H "Authorization: Bearer $TOKEN" | jq .

# 响应包含所有 7 个章节的 markdown 内容
```

### 10. 知识库搜索测试
```bash
curl -X POST http://localhost:3001/api/v1/kb/$KB_ID/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "query": "项目式学习的实施步骤",
    "topK": 5
  }'
```
