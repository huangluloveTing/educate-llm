import { tool } from "ai";
import { z } from "zod";

import { embedQuery } from "../services/embeddings.js";
import { getCollectionName, getQdrantClient } from "../services/qdrant.js";

export type RagSource = {
  ref: string;
  score: number;
  filename: string;
  documentId: string;
  chunkIndex: number;
  text: string;
};

export type KbSearchResult = {
  sources: RagSource[];
  error?: string;
};

/**
 * Creates RAG tools for a specific knowledge base.
 * The kbSearch tool allows the LLM to search the knowledge base for relevant content.
 */
export function createRagTools(options: {
  kbId: string;
  defaultTopK?: number;
  maxTextLength?: number;
}) {
  const { kbId, defaultTopK = 5, maxTextLength = 2000 } = options;
  let refCounter = 0;

  const inputSchema = z.object({
    query: z.string().describe("The search query to find relevant documents. Use specific keywords and phrases."),
    topK: z.number().min(1).max(20).optional().describe("Number of results to return (default: 5, max: 20)"),
  });

  type ToolInput = z.infer<typeof inputSchema>;

  return {
    kbSearch: tool({
      description: "Search the knowledge base for relevant documents and content. Use this to find information related to the user's question. Returns sources with reference numbers that you should cite in your response using the format (资料1), (资料2), etc.",
      inputSchema,
      execute: async (input: ToolInput): Promise<KbSearchResult> => {
        const { query, topK } = input;
        const actualTopK = topK ?? defaultTopK;

        try {
          // Embed the query
          const queryVector = await embedQuery(query);

          // Search the knowledge base
          const qdrant = getQdrantClient();
          const collectionName = getCollectionName(kbId);

          const hits = await qdrant.search(collectionName, {
            vector: queryVector,
            limit: actualTopK,
            with_payload: true,
            with_vector: false,
            filter: {
              must: [{
                key: "kbId",
                match: { value: kbId },
              }],
            },
          });

          // Map results to sources with reference numbers
          const sources: RagSource[] = hits.map((hit) => {
            refCounter++;
            const text = ((hit.payload as any)?.text as string) || "";
            return {
              ref: `资料${refCounter}`,
              score: hit.score,
              filename: ((hit.payload as any)?.filename as string) || "未知文件",
              documentId: ((hit.payload as any)?.documentId as string) || "",
              chunkIndex: ((hit.payload as any)?.chunkIndex as number) || 0,
              text: text.length > maxTextLength ? `${text.slice(0, maxTextLength)}...` : text,
            };
          });

          return { sources };
        }
        catch (error) {
          console.error("kbSearch tool error:", error);
          return {
            sources: [],
            error: error instanceof Error ? error.message : "检索失败",
          };
        }
      },
    }),
  };
}

/**
 * System prompt for RAG-based chat with tool calling.
 */
export const RAG_SYSTEM_PROMPT = `你是一位教育研究助手。你可以使用 kbSearch 工具搜索知识库获取相关资料。

重要规则：
1. 回答问题前，先使用 kbSearch 工具搜索相关资料
2. 如果工具返回了资料，在回答中引用来源，格式为：(资料1)、(资料2) 等
3. 如果工具返回的 sources 为空或没有相关资料，你可以基于教育学常识回答，但必须在回答开头明确声明："【无参考资料，以下基于通用教育知识】"
4. 如果资料不足以支持结论，请明确说明"不确定/资料不足"
5. 引用时要准确对应工具返回的 ref 字段值`;
