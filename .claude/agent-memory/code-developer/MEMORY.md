# Code Developer Memory

## Project Structure
- Monorepo: apps/api (Express + Prisma), apps/web (React + Vite + Ant Design)
- Storage: storage/uploads/<kbId>/<documentId>/<filename> for documents
- Storage: storage/reports/<jobId>.pdf for generated reports

## Key Patterns

### API Routes
- All routes mounted in apps/api/src/api/index.ts
- Documents API: apps/api/src/api/documents/index.ts (single source of truth)
- Chat SSE: apps/api/src/api/chat/index.ts
- Reports SSE: apps/api/src/api/reports/index.ts
- Route pattern: /api/v1/<resource>

### SSE Implementation
- Use sseInit(res) to set headers: text/event-stream, no-cache, keep-alive
- Use sseSend(res, {event, data}) to send events
- Format: `event: <name>\ndata: <json>\n\n`
- Frontend parsing: Use fetch() + ReadableStream (NOT EventSource for POST)
- **CRITICAL**: Use indexed for-loop when parsing SSE lines to avoid skipping events

### LLM Integration
- Use createChatModel() from apps/api/src/llm/chatModel.ts
- Always check env.LLM_API_KEY before calling LLM
- Use streaming: `for await (const chunk of await llm.stream(messages))`

### Embeddings & RAG
- embedQuery() from apps/api/src/services/embeddings.ts
- Qdrant collections: kb_<kbId>
- Search with filter: must match kbId
- Payload: {text, filename, documentId, chunkIndex, kbId}

### PDF Generation
- Use pdfkit for PDF creation
- Use marked to convert markdown to HTML, then strip tags for plain text
- Support custom fonts via env.PDF_FONT_PATH (optional)
- Always use fs.createWriteStream wrapped in Promise for async

### Error Handling
- Always return {message: string} format
- SSE errors: send event:error instead of HTTP errors
- Validate required env vars (LLM_API_KEY) before processing

## Common Issues Fixed

1. **SSE Parsing Bug**: Never use `array.shift()` during for-of iteration. Use indexed for-loop with i++ to skip data line.
2. **Document Routes**: Single implementation in documents/index.ts, not in kb/documents.ts
3. **Storage Deletion**: Delete both Qdrant points and file system directory when deleting documents

## Environment Variables
- LLM_API_KEY must be set for chat/reports (validate early)
- STORAGE_DIR for uploads and reports
- PDF_FONT_PATH optional for custom fonts in PDF
