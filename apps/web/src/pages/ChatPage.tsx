import { Bubble, Conversations, Sender, type ConversationItemType } from "@ant-design/x";
import { Card, Collapse, Drawer, Form, Input, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { SettingOutlined, PlusOutlined } from "@ant-design/icons";

import { apiFetch } from "../lib/api";

type Kb = { id: string; name: string };

type Conversation = {
  id: string;
  title: string | null;
  systemPrompt: string | null;
  kbId: string | null;
  kb: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

type SourceInfo = {
  ref: string;
  score: number;
  filename: string;
  documentId: string;
  chunkIndex: number;
  text: string;
};

export default function ChatPage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editForm] = Form.useForm();

  // Load KBs and conversations
  useEffect(() => {
    loadKbs();
    loadConversations();
  }, []);

  async function loadKbs() {
    try {
      const data = await apiFetch<Kb[]>("/kb");
      setKbs(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载知识库失败");
    }
  }

  async function loadConversations() {
    try {
      const data = await apiFetch<Conversation[]>("/conversations");
      setConversations(data);
      if (data.length > 0 && !selectedConversation) {
        setSelectedConversation(data[0]);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载会话列表失败");
    }
  }

  async function createConversation() {
    try {
      const data = await apiFetch<Conversation>("/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "新对话" }),
      });
      setConversations([data, ...conversations]);
      setSelectedConversation(data);
      message.success("创建成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建会话失败");
    }
  }

  async function deleteConversation(id: string) {
    try {
      await apiFetch(`/conversations/${id}`, { method: "DELETE" });
      setConversations(conversations.filter((c) => c.id !== id));
      if (selectedConversation?.id === id) {
        setSelectedConversation(conversations.find((c) => c.id !== id) || null);
      }
      message.success("删除成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除会话失败");
    }
  }

  async function updateConversation(values: { title?: string; kbId?: string | null; systemPrompt?: string }) {
    if (!selectedConversation) return;

    try {
      const data = await apiFetch<Conversation>(`/conversations/${selectedConversation.id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      setConversations(conversations.map((c) => (c.id === data.id ? data : c)));
      setSelectedConversation(data);
      setDrawerOpen(false);
      message.success("更新成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "更新会话失败");
    }
  }

  const getAccessToken = useCallback(() => localStorage.getItem("accessToken"), []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${import.meta.env.VITE_API_BASE_URL}/chat/stream`,
        headers: async () => ({
          Authorization: `Bearer ${getAccessToken()}`,
        }),
      }),
    [getAccessToken]
  );

  const {
    messages,
    sendMessage,
    status,
    error,
  } = useChat({
    id: "chat",
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = useCallback(
    (content: string) => {
      if (!content.trim() || !selectedConversation) return;
      sendMessage(
        { text: content },
        { body: { conversationId: selectedConversation.id } }
      );
    },
    [selectedConversation, sendMessage]
  );

  // Get all sources from the last assistant message
  const getLastAssistantSources = useCallback((): SourceInfo[] => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.parts) return [];

    const sources: SourceInfo[] = [];
    for (const part of lastAssistant.parts) {
      if (part.type === "tool-output-available") {
        const output = part.output as { sources?: SourceInfo[] } | undefined;
        if (output?.sources) {
          sources.push(...output.sources);
        }
      }
    }
    return sources;
  }, [messages]);

  const getToolInvocations = useCallback((msg: UIMessage) => {
    if (!msg.parts) return [];
    return msg.parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
  }, []);

  const sources = getLastAssistantSources();

  const getToolName = (part: { type: string }): string => {
    if (part.type === "dynamic-tool") {
      return (part as { toolName?: string }).toolName || "unknown";
    }
    if (part.type.startsWith("tool-")) {
      return part.type.replace("tool-", "");
    }
    return "unknown";
  };

  const getToolStatus = (part: { type: string; state?: string }): "calling" | "completed" | "error" => {
    if ("state" in part) {
      const state = (part as { state: string }).state;
      if (state === "output-error") return "error";
      if (state === "output-available") return "completed";
    }
    return "calling";
  };

  // 转换会话列表
  const conversationItems: ConversationItemType[] = conversations.map((conv) => ({
    key: conv.id,
    label: conv.title || "未命名会话",
    description: conv.kb?.name || "未选择知识库",
  }));

  // 自定义消息渲染
  const renderMessage = useCallback(
    (msgInfo: { content: string; role: string; key?: string }) => {
      const isUser = msgInfo.role === "user";
      const msg = messages.find((m) => m.id === msgInfo.key);
      const toolInvocations = msg ? getToolInvocations(msg) : [];

      return (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            backgroundColor: isUser ? "#e6f7ff" : "#f5f5f5",
            borderRadius: 8,
            maxWidth: "80%",
            marginLeft: isUser ? "auto" : 0,
          }}
        >
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            {isUser ? "你" : "助手"}
          </Typography.Text>

          {/* 消息内容 */}
          <div style={{ whiteSpace: "pre-wrap" }}>
            <ReactMarkdown>{msgInfo.content}</ReactMarkdown>
          </div>

          {/* 工具调用信息 */}
          {toolInvocations.length > 0 && (
            <Collapse
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: "tools",
                  label: "工具调用",
                  children: toolInvocations.map((part, i) => {
                    const toolName = getToolName(part);
                    const toolStatus = getToolStatus(part);
                    const output = "output" in part ? (part as { output?: unknown }).output : undefined;

                    return (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <Space>
                          <Tag
                            color={
                              toolStatus === "calling"
                                ? "processing"
                                : toolStatus === "error"
                                  ? "error"
                                  : "success"
                            }
                          >
                            {toolName}
                          </Tag>
                          <span style={{ fontSize: 12, color: "#999" }}>
                            {toolStatus === "calling"
                              ? "调用中..."
                              : toolStatus === "error"
                                ? "失败"
                                : "完成"}
                          </span>
                        </Space>
                        {output !== undefined && (
                          <pre
                            style={{
                              fontSize: 10,
                              margin: "4px 0",
                              background: "#fff",
                              padding: 4,
                              borderRadius: 4,
                              maxHeight: 100,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(output, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  }),
                },
              ]}
            />
          )}

          {/* 参考资料 - 仅显示最后一条助手消息的 */}
          {!isUser && sources.length > 0 && msg === messages[messages.length - 1] && (
            <Card size="small" title="参考资料" style={{ marginTop: 12 }}>
              {sources.map((src, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>
                    {src.ref}: {src.filename} (相似度: {src.score.toFixed(3)})
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
        </div>
      );
    },
    [messages, getToolInvocations, sources]
  );

  // 转换消息为 Bubble 格式
  const bubbleItems = messages.map((msg) => {
    const textContent = msg.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("") || "";

    return {
      key: msg.id,
      role: msg.role,
      content: textContent,
    };
  });

  return (
    <div style={{ height: "calc(100vh - 64px)", display: "flex", gap: 16, padding: 16 }}>
      {/* 左侧会话列表 */}
      <Card style={{ width: 280, flexShrink: 0 }} styles={{ body: { padding: 12, height: "100%", display: "flex", flexDirection: "column" } }}>
        <Conversations
          activeKey={selectedConversation?.id}
          items={conversationItems}
          onActiveChange={(key) => {
            const conv = conversations.find((c) => c.id === key);
            if (conv) setSelectedConversation(conv);
          }}
          menu={() => [{ label: "删除", key: "delete" }]}
          onMenuClick={(conv, info) => {
            if (info.key === "delete") {
              deleteConversation(conv.key as string);
            }
          }}
        />
      </Card>

      {/* 右侧聊天区域 */}
      <Card style={{ flex: 1, display: "flex", flexDirection: "column" }} styles={{ body: { flex: 1, display: "flex", flexDirection: "column", padding: 16 } }}>
        {/* 标题栏 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {selectedConversation?.title || "选择一个会话"}
          </Typography.Title>
          {selectedConversation && (
            <button
              type="button"
              onClick={() => {
                editForm.setFieldsValue({
                  title: selectedConversation.title || "",
                  kbId: selectedConversation.kbId || undefined,
                  systemPrompt: selectedConversation.systemPrompt || "",
                });
                setDrawerOpen(true);
              }}
              style={{
                padding: "4px 12px",
                background: "#fff",
                border: "1px solid #d9d9d9",
                borderRadius: 6,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <SettingOutlined /> 设置
            </button>
          )}
        </div>

        {/* 知识库标签 */}
        {selectedConversation?.kb && (
          <Tag color="blue" style={{ marginBottom: 16 }}>
            知识库: {selectedConversation.kb.name}
          </Tag>
        )}

        {/* 消息列表 */}
        <div style={{ flex: 1, overflow: "auto", marginBottom: 16 }}>
          {!selectedConversation && (
            <Typography.Text type="secondary">请选择或创建一个会话开始聊天</Typography.Text>
          )}
          {bubbleItems.length === 0 && selectedConversation && (
            <Typography.Text type="secondary">开始对话...</Typography.Text>
          )}
          {bubbleItems.map((item) => renderMessage(item as { content: string; role: string; key?: string }))}
          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div style={{ textAlign: "center", padding: 16 }}>
              <Tag color="processing">思考中...</Tag>
            </div>
          )}
          {error && <Typography.Text type="danger">错误: {error.message}</Typography.Text>}
        </div>

        {/* 输入框 */}
        <Sender
          loading={isLoading}
          disabled={!selectedConversation}
          onSubmit={handleSend}
          placeholder="输入你的问题..."
        />
      </Card>

      {/* 设置抽屉 */}
      <Drawer title="会话设置" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={400}>
        <Form form={editForm} layout="vertical" onFinish={updateConversation}>
          <Form.Item name="title" label="会话标题">
            <Input placeholder="输入会话标题" />
          </Form.Item>

          <Form.Item name="kbId" label="关联知识库">
            <Select placeholder="选择知识库" allowClear>
              {kbs.map((kb) => (
                <Select.Option key={kb.id} value={kb.id}>
                  {kb.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="systemPrompt" label="系统提示词">
            <Input.TextArea rows={6} placeholder="自定义系统提示词，留空使用默认提示词" />
          </Form.Item>

          <Form.Item>
            <Space>
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  background: "#1677ff",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                style={{
                  padding: "8px 16px",
                  background: "#fff",
                  border: "1px solid #d9d9d9",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}