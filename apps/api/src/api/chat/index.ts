import { streamText } from "ai";
import express from "express";

import { requireAuth } from "../../auth/middleware.js";
import { env } from "../../env.js";
import { createAiSdkModel } from "../../llm/ai-sdk-model.js";
import { embedQuery } from "../../services/embeddings.js";
import { getCollectionName, getQdrantClient } from "../../services/qdrant.js";

const router = express.Router();

type ChatReqBody = {
  kbId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  retrieval?: { topK?: number };
};

router.post("/chat/stream", requireAuth, async (req, res) => {
  try {
    const body = req.body as ChatReqBody;
    if (!body || typeof body.kbId !== "string" || !Array.isArray(body.messages)) {
      return res.status(400).json({ message: "参数无效" });
    }

    if (!env.LLM_API_KEY) {
      return res.status(500).json({ message: "LLM_API_KEY 未配置" });
    }

    const lastUser = [...body.messages].reverse().find(m => m.role === "user");
    if (!lastUser || !lastUser.content?.trim()) {
      return res.status(400).json({ message: "用户消息不能为空" });
    }

    const topK = Math.min(Math.max(body.retrieval?.topK ?? 5, 1), 20);

    // Retrieve (best-effort). If retrieval fails / no hits, still chat normally.
    const qdrant = getQdrantClient();
    const collectionName = getCollectionName(body.kbId);

    let sources: Array<{
      score: number;
      filename: string;
      documentId: string;
      chunkIndex: number;
      text: string;
    }> = [];

    try {
      const queryVector = await embedQuery(lastUser.content.trim());

      const hits = await qdrant.search(collectionName, {
        vector: queryVector,
        limit: topK,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [{
            key: "kbId",
            match: { value: body.kbId },
          }],
        },
      });

      sources = hits.map(h => ({
        score: h.score,
        filename: (h.payload as any)?.filename as string,
        documentId: (h.payload as any)?.documentId as string,
        chunkIndex: (h.payload as any)?.chunkIndex as number,
        text: ((h.payload as any)?.text as string)?.slice(0, 5000),
      }));
    }
    catch (error) {
      // e.g. collection not found, embeddings service error, etc.
      console.warn("RAG retrieval failed, falling back to normal chat:", error);
      sources = [];
    }

    const hasSources = sources.length > 0;

    const contextText = sources
      .map((s, i) => `[资料${i + 1}] 文件: ${s.filename} (chunk ${s.chunkIndex})\n${s.text}`)
      .join("\n\n");

    const systemPrompt = hasSources
      ? `你是一位教育研究助手。请严格基于提供的参考资料回答问题。
- 如果资料不足以支持结论，请明确说明"不确定/资料不足"。
- 在回答中引用资料来源，格式为：(资料1)、(资料2)。

参考资料：
${contextText}`
      : `你是一位教育研究助手。当前知识库未检索到与用户问题直接相关的参考资料。
请基于通用教育学知识与常识进行回答，并明确说明这是在"无参考资料"情况下的通用建议。
如果用户需要基于资料的结论，请提示用户：上传/补充相关文档，或更换更具体的关键词再提问。`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...body.messages,
    ];

    const model = createAiSdkModel();

    const result = streamText({
      model,
      messages,
      temperature: 0.2,
    });

    // 发送 sources 作为自定义数据（在流之前）
    const sourcesJson = JSON.stringify({ sources, hasSources });
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 先发送 sources
    res.write(`event: sources\ndata: ${sourcesJson}\n\n`);

    // 流式输出文本
    for await (const chunk of result.textStream) {
      res.write(`event: token\ndata: ${JSON.stringify({ content: chunk })}\n\n`);
    }

    // 发送完成
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : "聊天失败";
    if (!res.headersSent) {
      res.status(500).json({ message: msg });
    }
    else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
      res.end();
    }
  }
});

export default router;
