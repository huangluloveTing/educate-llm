import { Button, Card, Input, Select, Typography, message, Space, Spin } from "antd";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import { apiFetch } from "../lib/api";

type Kb = { id: string; name: string };

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Source = {
  score: number;
  filename: string;
  documentId: string;
  chunkIndex: number;
  text: string;
};

export default function ChatPage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [selectedKb, setSelectedKb] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);

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

  async function sendMessage() {
    if (!input.trim() || !selectedKb) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setSources([]);

    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kbId: selectedKb,
          messages: [...messages, userMessage],
          retrieval: { topK: 5 },
        }),
      });

      if (!response.ok) {
        throw new Error("聊天请求失败");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("无响应内容");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith("event:")) {
            const event = line.slice(6).trim();
            const nextLine = lines[i + 1];
            if (nextLine && nextLine.startsWith("data:")) {
              const data = JSON.parse(nextLine.slice(5).trim());

              if (event === "sources") {
                setSources(data.sources || []);
              }
              else if (event === "token") {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg && lastMsg.role === "assistant") {
                    lastMsg.content += data.content || "";
                  }
                  return newMessages;
                });
              }
              else if (event === "done") {
                setLoading(false);
              }
              else if (event === "error") {
                message.error(data.message || "聊天出错");
                setLoading(false);
              }
              i++; // Skip the data line
            }
          }
        }
      }
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "聊天失败");
      // Remove incomplete assistant message
      setMessages((prev) => prev.filter((m) => m.content.length > 0 || m.role !== "assistant"));
    }
    finally {
      setLoading(false);
    }
  }

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
                key={i}
                style={{
                  marginBottom: 16,
                  padding: 12,
                  backgroundColor: msg.role === "user" ? "#e6f7ff" : "#f5f5f5",
                  borderRadius: 4,
                }}
              >
                <Typography.Text strong>{msg.role === "user" ? "你" : "助手"}:</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ textAlign: "center", padding: 16 }}>
                <Spin />
              </div>
            )}
          </div>

          {sources.length > 0 && (
            <Card size="small" title="参考资料">
              {sources.map((src, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>
                    资料 {i + 1}: {src.filename} (chunk {src.chunkIndex}, 相似度: {src.score.toFixed(3)})
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

          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="输入你的问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={sendMessage}
              disabled={!selectedKb || loading}
            />
            <Button type="primary" onClick={sendMessage} disabled={!selectedKb || loading || !input.trim()}>
              发送
            </Button>
          </Space.Compact>
        </Space>
      </Card>
    </div>
  );
}
