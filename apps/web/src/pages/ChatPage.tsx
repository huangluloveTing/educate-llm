import { Button, Card, Collapse, Drawer, Form, Input, List, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageOutlined, SettingOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";

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
  _count?: { messages: number };
};

export default function ChatPage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
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
    }
    catch (e) {
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
    }
    catch (e) {
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
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "创建会话失败");
    }
  }

  async function deleteConversation(id: string) {
    try {
      await apiFetch(`/conversations/${id}`, { method: "DELETE" });
      setConversations(conversations.filter(c => c.id !== id));
      if (selectedConversation?.id === id) {
        setSelectedConversation(conversations.find(c => c.id !== id) || null);
      }
      message.success("删除成功");
    }
    catch (e) {
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
      setConversations(conversations.map(c => c.id === data.id ? data : c));
      setSelectedConversation(data);
      setEditModalOpen(false);
      message.success("更新成功");
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "更新会话失败");
    }
  }

  const getAccessToken = () => localStorage.getItem("accessToken");

  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: `${import.meta.env.VITE_API_BASE_URL}/chat/stream`,
      headers: async () => ({
        Authorization: `Bearer ${getAccessToken()}`,
      }),
      body: {
        conversationId: selectedConversation?.id,
      },
    }),
  });

  const handleSendMessage = async () => {
    if (!input.trim() || !selectedConversation) return;

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
      if (part.type === "tool-output-available") {
        const output = part.output as { sources?: typeof sources } | undefined;
        if (output?.sources) {
          sources.push(...output.sources);
        }
      }
    }
    return sources;
  };

  const getToolInvocations = (msg: UIMessage) => {
    if (!msg.parts) return [];
    return msg.parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
  };

  const sources = getLastAssistantSources();
  const isLoading = status === "submitted" || status === "streaming";

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

  const openEditModal = () => {
    if (selectedConversation) {
      editForm.setFieldsValue({
        title: selectedConversation.title || "",
        kbId: selectedConversation.kbId || undefined,
        systemPrompt: selectedConversation.systemPrompt || "",
      });
      setEditModalOpen(true);
    }
  };

  return (
    <div style={{ maxWidth: 1400, display: "flex", gap: 16 }}>
      {/* Conversation List Sidebar */}
      <Card style={{ width: 280, flexShrink: 0 }} bodyStyle={{ padding: 12 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Button type="primary" icon={<PlusOutlined />} block onClick={createConversation}>
            新建会话
          </Button>

          <div style={{ height: 500, overflowY: "auto" }}>
            <List
              dataSource={conversations}
              renderItem={(conv) => (
                <List.Item
                  onClick={() => setSelectedConversation(conv)}
                  style={{
                    cursor: "pointer",
                    padding: "8px 12px",
                    borderRadius: 4,
                    backgroundColor: selectedConversation?.id === conv.id ? "#e6f7ff" : "transparent",
                  }}
                  actions={[
                    <DeleteOutlined
                      key="delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={conv.title || "未命名会话"}
                    description={conv.kb?.name || "未选择知识库"}
                  />
                </List.Item>
              )}
            />
          </div>
        </Space>
      </Card>

      {/* Main Chat Area */}
      <Card style={{ flex: 1 }} bodyStyle={{ padding: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {selectedConversation?.title || "选择一个会话"}
            </Typography.Title>
            {selectedConversation && (
              <Button icon={<SettingOutlined />} onClick={openEditModal}>
                设置
              </Button>
            )}
          </div>

          {/* Knowledge Base Info */}
          {selectedConversation?.kb && (
            <Tag color="blue">知识库: {selectedConversation.kb.name}</Tag>
          )}

          {/* Messages */}
          <div
            style={{
              height: 400,
              overflowY: "auto",
              border: "1px solid #d9d9d9",
              borderRadius: 4,
              padding: 16,
            }}
          >
            {!selectedConversation && (
              <Typography.Text type="secondary">请选择或创建一个会话开始聊天</Typography.Text>
            )}
            {messages.length === 0 && selectedConversation && (
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

          {/* Tool Calls */}
          {messages.length > 0 && (
            <Collapse size="small">
              <Collapse.Panel header="工具调用" key="tools">
                {messages.flatMap((msg, msgIdx) =>
                  getToolInvocations(msg).map((part, partIdx) => {
                    const key = `${msg.id || msgIdx}-${partIdx}`;
                    const toolName = getToolName(part);
                    const toolStatus = getToolStatus(part);
                    const input = "input" in part ? (part as { input?: unknown }).input : undefined;
                    const output = "output" in part ? (part as { output?: unknown }).output : undefined;

                    return (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <Space>
                          <Tag color={toolStatus === "calling" ? "processing" : toolStatus === "error" ? "error" : "success"}>
                            {toolName}
                          </Tag>
                          <span style={{ fontSize: 12, color: "#999" }}>
                            {toolStatus === "calling" ? "调用中..." : toolStatus === "error" ? "失败" : "完成"}
                          </span>
                        </Space>
                        {output !== undefined && (
                          <pre style={{ fontSize: 10, margin: "4px 0", background: "#f5f5f5", padding: 4, borderRadius: 4, maxHeight: 100, overflow: "auto" }}>
                            {JSON.stringify(output, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  }),
                )}
              </Collapse.Panel>
            </Collapse>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <Card size="small" title="参考资料">
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

          {error && <Typography.Text type="danger">错误: {error.message}</Typography.Text>}

          {/* Input */}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="输入你的问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSendMessage}
              disabled={!selectedConversation || isLoading}
            />
            <Button type="primary" onClick={handleSendMessage} disabled={!selectedConversation || isLoading || !input.trim()}>
              发送
            </Button>
          </Space.Compact>
        </Space>
      </Card>

      {/* Edit Conversation Modal */}
      <Modal
        title="会话设置"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        footer={null}
      >
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
              <Button type="primary" htmlType="submit">
                保存
              </Button>
              <Button onClick={() => setEditModalOpen(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}