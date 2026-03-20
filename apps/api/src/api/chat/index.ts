import type { Request } from "express";

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

import { env } from "../../env.js";
import { requireAuth } from "../../auth/middleware.js";
import { embedQuery } from "../../services/embeddings.js";
import { createChatModel } from "../../llm/chatModel.js";
import { sseInit, sseSend } from "../../utils/sse.js";

import express from "express";
import { getQdrantClient, getCollectionName } from "../../services/qdrant.js";

const router = express.Router();

type ChatReqBody = {
  kbId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  retrieval?: { topK?: number };
};

router.post("/chat/stream", requireAuth, async (req, res) => {
  sseInit(res);

  try {
    const body = req.body as ChatReqBody;
    if (!body || typeof body.kbId !== "string" || !Array.isArray(body.messages)) {
      sseSend(res, { event: "error", data: { message: "Invalid parameters" } });
      return res.end();
    }

    if (!env.LLM_API_KEY) {
      sseSend(res, { event: "error", data: { message: "LLM_API_KEY not configured" } });
      return res.end();
    }

    const lastUser = [...body.messages].reverse().find(m => m.role === "user");
    if (!lastUser || !lastUser.content?.trim()) {
      sseSend(res, { event: "error", data: { message: "User message is required" } });
      return res.end();
    }

    const topK = Math.min(Math.max(body.retrieval?.topK ?? 5, 1), 20);

    // Retrieve
    const qdrant = getQdrantClient();
    const collectionName = getCollectionName(body.kbId);

    const embeddings = await import("../../services/embeddings.js");
    const queryVector = await embeddings.embedQuery(lastUser.content.trim());

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

    const sources = hits.map(h => ({
      score: h.score,
      filename: (h.payload as any)?.filename as string,
      documentId: (h.payload as any)?.documentId as string,
      chunkIndex: (h.payload as any)?.chunkIndex as number,
      text: ((h.payload as any)?.text as string)?.slice(0, 5000),
    }));

    sseSend(res, { event: "sources", data: { sources } });

    const contextText = sources
      .map((s, i) => `[Source ${i + 1}] File: ${s.filename} (chunk ${s.chunkIndex})\n${s.text}`)
      .join("\n\n");

    const system = new SystemMessage(
      `You are an education research assistant. Answer questions strictly based on the provided materials.\n` +
      `- If the materials are insufficient to support a conclusion, clearly state "uncertain/insufficient materials".\n` +
      `- In your answer, cite sources in the format: (Source 1), (Source 2).\n\n` +
      `Materials:\n${contextText}`,
    );

    const chatMessages: (SystemMessage | HumanMessage | AIMessage)[] = [system];
    for (const m of body.messages) {
      if (m.role === "user") chatMessages.push(new HumanMessage(m.content));
      else chatMessages.push(new AIMessage(m.content));
    }

    const llm = createChatModel();

    for await (const chunk of await llm.stream(chatMessages)) {
      const content = (chunk as any)?.content;
      if (typeof content === "string" && content.length > 0) {
        sseSend(res, { event: "token", data: { content } });
      }
    }

    sseSend(res, { event: "done", data: {} });
    res.end();
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : "Chat failed";
    sseSend(res, { event: "error", data: { message: msg } });
    res.end();
  }
});

export default router;
