import { Card, Typography } from "antd";

export default function NewReportPage() {
  return (
    <Card style={{ maxWidth: 900 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        生成课题报告
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        下一步会接入编排流程（检索→大纲→分章→汇总→PDF）与 SSE 流式生成。
      </Typography.Paragraph>
    </Card>
  );
}
