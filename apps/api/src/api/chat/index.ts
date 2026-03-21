import type { UIMessage } from "ai";

import { convertToModelMessages, stepCountIs, streamText } from "ai";
import express from "express";

import { requireAuth } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../env.js";
import { createAiSdkModel } from "../../llm/ai-sdk-model.js";
import { createRagTools, RAG_SYSTEM_PROMPT } from "../../llm/rag-tools.js";

const router = express.Router();

type ChatReqBody = {
  conversationId: string;
  messages: UIMessage[];
};

router.post("/chat/stream", requireAuth, async (req, res) => {
  try {
    const body = req.body as ChatReqBody;
    if (!body || typeof body.conversationId !== "string" || !Array.isArray(body.messages)) {
      return res.status(400).json({ message: "参数无效" });
    }

    if (!env.LLM_API_KEY) {
      return res.status(500).json({ message: "LLM_API_KEY 未配置" });
    }

    // Get conversation with knowledge base
    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversationId, createdById: req.user!.id },
      include: { kb: true },
    });

    if (!conversation) {
      return res.status(404).json({ message: "会话不存在" });
    }

    // Convert UIMessage to ModelMessage format
    const modelMessages = await convertToModelMessages(body.messages);

    // Build system prompt: custom prompt > default
    const systemPrompt = conversation.systemPrompt || RAG_SYSTEM_PROMPT;

    // Build messages with system prompt
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...modelMessages,
    ];

    // Create model
    const model = createAiSdkModel();

    // Create tools if kb is associated
    const tools = conversation.kbId
      ? createRagTools({ kbId: conversation.kbId, defaultTopK: 5 })
      : undefined;

    // Stream with tool calling
    const result = streamText({
      model,
      messages,
      tools,
      toolChoice: tools ? "auto" : undefined,
      stopWhen: stepCountIs(4),
      temperature: 0.2,
    });

    // Save user message to DB
    const lastUserMessage = [...body.messages].reverse().find(m => m.role === "user");
    if (lastUserMessage) {
      const userText = lastUserMessage.parts?.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("") || "";
      if (userText) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: userText,
          },
        });
      }
    }

    // Collect assistant response
    let assistantContent = "";

    // Use AI SDK's built-in UI message stream response
    result.pipeUIMessageStreamToResponse(res, {
      sendSources: true,
      onFinish: async ({ responseMessage }) => {
        // Save assistant message to DB
        const textParts = responseMessage.parts?.filter((p) => p.type === "text") as Array<{ type: "text"; text: string }> | undefined;
        const assistantText = textParts?.map(p => p.text).join("") || "";
        if (assistantText) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "assistant",
              content: assistantText,
            },
          });
        }

        // Update conversation timestamp
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });
      },
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