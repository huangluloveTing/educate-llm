import { Card, Typography } from "antd";

export default function ChatPage() {
  return (
    <Card style={{ maxWidth: 900 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        聊天（RAG）
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        下一步会接入 SSE 流式输出与知识库选择。
      </Typography.Paragraph>
    </Card>
  );
}
