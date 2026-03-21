import { Button, Card, Collapse, Input, Select, Typography, message, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import { apiFetch } from "../lib/api";

type Kb = { id: string; name: string };

export default function ChatPage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [selectedKb, setSelectedKb] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // Get access token for authorization
  const getAccessToken = () => localStorage.getItem("accessToken");

  const {
    messages,
    sendMessage,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({
      api: `${import.meta.env.VITE_API_BASE_URL}/chat/stream`,
      headers: async () => ({
        Authorization: `Bearer ${getAccessToken()}`,
      }),
      body: {
        kbId: selectedKb,
      },
    }),
  });

  useEffect(() => {
    loadKbs();
  }, []);

  async function loadKbs() {
    try {
      const data = await apiFetch<Kb[]>("/kb");
      setKbs(data);
      if (data.length > 0) {
        setSelectedKb(data[0].id);
      }
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "加载知识库失败");
    }
  }

  const handleSendMessage = async () => {
    if (!input.trim() || !selectedKb) return;

    const text = input.trim();
    setInput("");

    await sendMessage({ text });
  };

  // Get all sources from the last assistant message
  const getLastAssistantSources = () => {
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    if (!lastAssistant?.parts) return [];

    const sources: Array<{
      ref: string;
      score: number;
      filename: string;
      documentId: string;
      chunkIndex: number;
      text: string;
    }> = [];

    for (const part of lastAssistant.parts) {
      // Check for tool-kbSearch parts with output
      if (part.type === "tool-kbSearch" && "output" in part && part.output) {
        const output = part.output as { sources?: typeof sources } | undefined;
        if (output?.sources) {
          sources.push(...output.sources);
        }
      }
    }
    return sources;
  };

  // Get tool invocations from a message
  const getToolInvocations = (msg: UIMessage) => {
    if (!msg.parts) return [];
    // Filter for tool parts (type starts with "tool-") or dynamic-tool
    return msg.parts.filter((p) =>
      p.type.startsWith("tool-") || p.type === "dynamic-tool",
    );
  };

  const sources = getLastAssistantSources();
  const isLoading = status === "submitted" || status === "streaming";

  // Extract tool name from part type
  const getToolName = (part: { type: string }): string => {
    if (part.type === "dynamic-tool") {
      return (part as { toolName?: string }).toolName || "unknown";
    }
    if (part.type.startsWith("tool-")) {
      return part.type.replace("tool-", "");
    }
    return "unknown";
  };

  // Get status from tool part
  const getToolStatus = (part: { type: string; state?: string }): "calling" | "completed" | "error" => {
    if ("state" in part) {
      const state = (part as { state: string }).state;
      if (state === "output-error") return "error";
      if (state === "output-available") return "completed";
    }
    return "calling";
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          RAG 聊天
        </Typography.Title>

        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <div>
            <Typography.Text strong>选择知识库：</Typography.Text>
            <Select
              value={selectedKb}
              onChange={setSelectedKb}
              style={{ width: "100%", marginTop: 8 }}
              placeholder="选择知识库"
            >
              {kbs.map((kb) => (
                <Select.Option key={kb.id} value={kb.id}>
                  {kb.name}
                </Select.Option>
              ))}
            </Select>
          </div>

          <div
            style={{
              height: 500,
              overflowY: "auto",
              border: "1px solid #d9d9d9",
              borderRadius: 4,
              padding: 16,
            }}
          >
            {messages.length === 0 && (
              <Typography.Text type="secondary">开始对话...</Typography.Text>
            )}
            {messages.map((msg, i) => (
              <div
                key={msg.id || i}
                style={{
                  marginBottom: 16,
                  padding: 12,
                  backgroundColor: msg.role === "user" ? "#e6f7ff" : "#f5f5f5",
                  borderRadius: 4,
                }}
              >
                <Typography.Text strong>{msg.role === "user" ? "你" : "助手"}:</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  {msg.role === "assistant" ? (
                    <>
                      {/* Render text parts */}
                      {msg.parts?.filter(p => p.type === "text").map((part, j) => (
                        <ReactMarkdown key={j}>{(part as { text: string }).text}</ReactMarkdown>
                      ))}
                    </>
                  ) : (
                    <ReactMarkdown>{msg.parts?.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("")}</ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div style={{ textAlign: "center", padding: 16 }}>
                <Tag color="processing">思考中...</Tag>
              </div>
            )}
          </div>

          {/* Tool Calls Debug Panel */}
          {messages.length > 0 && (
            <Card size="small" title="工具调用">
              <Collapse size="small">
                {messages.flatMap((msg, msgIdx) =>
                  getToolInvocations(msg).map((part, partIdx) => {
                    const key = `${msg.id || msgIdx}-${partIdx}`;
                    const toolName = getToolName(part);
                    const toolStatus = getToolStatus(part);
                    const input = "input" in part ? (part as { input?: unknown }).input : undefined;
                    const output = "output" in part ? (part as { output?: unknown }).output : undefined;
                    const errorText = "errorText" in part ? (part as { errorText?: string }).errorText : undefined;

                    return (
                      <Collapse.Panel
                        key={key}
                        header={(
                          <Space>
                            <Tag color={toolStatus === "calling" ? "processing" : toolStatus === "error" ? "error" : "success"}>
                              {toolName}
                            </Tag>
                            <span style={{ fontSize: 12, color: "#999" }}>
                              {toolStatus === "calling" ? "调用中..." : toolStatus === "error" ? "失败" : "完成"}
                            </span>
                          </Space>
                        )}
                      >
                        <div style={{ fontSize: 12 }}>
                          {input !== undefined && (
                            <div>
                              <strong>参数:</strong>
                              <pre style={{ margin: 4, background: "#f5f5f5", padding: 8, borderRadius: 4, overflow: "auto" }}>
                                {JSON.stringify(input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {output !== undefined && (
                            <div>
                              <strong>结果:</strong>
                              <pre style={{ margin: 4, background: "#f6ffed", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200 }}>
                                {JSON.stringify(output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {errorText && (
                            <div>
                              <strong>错误:</strong>
                              <pre style={{ margin: 4, background: "#fff2f0", padding: 8, borderRadius: 4 }}>
                                {errorText}
                              </pre>
                            </div>
                          )}
                        </div>
                      </Collapse.Panel>
                    );
                  }),
                )}
              </Collapse>
            </Card>
          )}

          {sources.length > 0 && (
            <Card size="small" title="参考资料">
              {sources.map((src, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>
                    {src.ref}: {src.filename} (chunk {src.chunkIndex}, 相似度: {src.score.toFixed(3)})
                  </Typography.Text>
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2, expandable: true }}
                    style={{ marginTop: 4, fontSize: 12 }}
                  >
                    {src.text}
                  </Typography.Paragraph>
                </div>
              ))}
            </Card>
          )}

          {error && (
            <Typography.Text type="danger">
              错误: {error.message}
            </Typography.Text>
          )}

          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="输入你的问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSendMessage}
              disabled={!selectedKb || isLoading}
            />
            <Button type="primary" onClick={handleSendMessage} disabled={!selectedKb || isLoading || !input.trim()}>
              发送
            </Button>
          </Space.Compact>
        </Space>
      </Card>
    </div>
  );
}