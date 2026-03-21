import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import express from "express";

import { requireAuth } from "../../auth/middleware.js";
import { env } from "../../env.js";
import { createAiSdkModel } from "../../llm/ai-sdk-model.js";
import { createRagTools, RAG_SYSTEM_PROMPT } from "../../llm/rag-tools.js";

const router = express.Router();

type ChatReqBody = {
  kbId: string;
  messages: UIMessage[];
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

    // Convert UIMessage to ModelMessage format
    const modelMessages = await convertToModelMessages(body.messages);

    // Create model and tools
    const model = createAiSdkModel();
    const tools = createRagTools({
      kbId: body.kbId,
      defaultTopK: 5,
    });

    // Build messages with system prompt
    const messages = [
      { role: "system" as const, content: RAG_SYSTEM_PROMPT },
      ...modelMessages,
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

    // Use AI SDK's built-in UI message stream response
    result.pipeUIMessageStreamToResponse(res, {
      sendSources: true, // Include sources in the stream
    });
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : "聊天失败";
    if (!res.headersSent) {
      res.status(500).json({ message: msg });
    }
  }
});

export default router;