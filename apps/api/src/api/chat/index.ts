import { streamText, stepCountIs } from "ai";
import express from "express";

import { requireAuth } from "../../auth/middleware.js";
import { env } from "../../env.js";
import { createAiSdkModel } from "../../llm/ai-sdk-model.js";
import { createRagTools, RAG_SYSTEM_PROMPT } from "../../llm/rag-tools.js";

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

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.write(":ok\n\n");

    // Create model and tools
    const model = createAiSdkModel();
    const tools = createRagTools({
      kbId: body.kbId,
      defaultTopK: body.retrieval?.topK ?? 5,
    });

    // Send initial empty sources
    res.write(`event: sources\ndata: ${JSON.stringify({ sources: [], hasSources: false })}\n\n`);

    // Build messages with system prompt
    const messages = [
      { role: "system" as const, content: RAG_SYSTEM_PROMPT },
      ...body.messages,
    ];

    // Stream with tool calling
    const result = streamText({
      model,
      messages,
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(4), // Allow up to 4 steps (e.g., search -> answer or multiple searches)
      temperature: 0.2,
    });

    // Track all sources from tool calls
    const allSources: Array<{
      ref: string;
      score: number;
      filename: string;
      documentId: string;
      chunkIndex: number;
      text: string;
    }> = [];

    // Process fullStream for SSE events
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          res.write(`event: token\ndata: ${JSON.stringify({ content: part.text })}\n\n`);
          break;
        }

        case "tool-call": {
          // Send tool call event
          res.write(`event: tool_call\ndata: ${JSON.stringify({
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            args: part.input,
          })}\n\n`);
          break;
        }

        case "tool-result": {
          // Extract sources from result if present
          const output = part.output as { sources?: typeof allSources; error?: string } | undefined;
          if (output?.sources && output.sources.length > 0) {
            allSources.push(...output.sources);
            // Send updated sources
            res.write(`event: sources\ndata: ${JSON.stringify({ sources: allSources, hasSources: true })}\n\n`);
          }

          // Send tool result event
          res.write(`event: tool_result\ndata: ${JSON.stringify({
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            result: output,
          })}\n\n`);
          break;
        }

        case "tool-error": {
          res.write(`event: tool_error\ndata: ${JSON.stringify({
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            error: part.error instanceof Error ? part.error.message : String(part.error),
          })}\n\n`);
          break;
        }

        case "error": {
          res.write(`event: error\ndata: ${JSON.stringify({ message: String(part.error) })}\n\n`);
          break;
        }

        case "finish": {
          // Final sources update
          res.write(`event: sources\ndata: ${JSON.stringify({ sources: allSources, hasSources: allSources.length > 0 })}\n\n`);
          break;
        }
      }
    }

    // Send done
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