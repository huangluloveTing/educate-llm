import { Button, Card, Form, Input, Select, Typography, message, Progress, Space } from "antd";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import { apiFetch } from "../lib/api";

type Kb = { id: string; name: string };

type Section = {
  title: string;
  order: number;
  markdown: string;
};

export default function NewReportPage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    loadKbs();
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

  async function generateReport(values: any) {
    setSections([]);
    setProgress(0);
    setDownloadUrl(null);
    setReportId(null);
    setGenerating(true);

    const totalSections = 7; // Fixed outline has 7 sections

    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/reports/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error("报告生成请求失败");
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

              if (event === "section") {
                setSections((prev) => {
                  const newSections = [...prev, data];
                  setProgress(Math.round((newSections.length / totalSections) * 100));
                  return newSections;
                });
              }
              else if (event === "done") {
                setProgress(100);
                setDownloadUrl(data.downloadUrl);
                setReportId(data.reportId);
                message.success("报告生成成功！");
                setGenerating(false);
              }
              else if (event === "error") {
                message.error(data.message || "报告生成出错");
                setGenerating(false);
              }
              i++; // Skip the data line
            }
          }
        }
      }
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "报告生成失败");
      setGenerating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          生成研究报告
        </Typography.Title>

        <Form layout="vertical" onFinish={generateReport}>
          <Form.Item
            label="知识库"
            name="kbId"
            rules={[{ required: true, message: "请选择知识库" }]}
          >
            <Select placeholder="选择知识库">
              {kbs.map((kb) => (
                <Select.Option key={kb.id} value={kb.id}>
                  {kb.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="研究课题"
            name="topic"
            rules={[{ required: true, message: "请输入研究课题" }]}
          >
            <Input placeholder="例如：STEM 教育中的项目式学习" />
          </Form.Item>

          <Form.Item label="学段（可选）" name="gradeLevel">
            <Input placeholder="例如：高中、初中" />
          </Form.Item>

          <Form.Item label="学科（可选）" name="subject">
            <Input placeholder="例如：数学、科学" />
          </Form.Item>

          <Form.Item label="研究周期（可选）" name="researchDuration">
            <Input placeholder="例如：6 个月、1 年" />
          </Form.Item>

          <Form.Item label="研究问题（可选）" name="researchQuestions">
            <Input.TextArea rows={3} placeholder="输入具体的研究问题..." />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={generating} disabled={generating} block>
              生成报告
            </Button>
          </Form.Item>
        </Form>

        {generating && (
          <Space direction="vertical" style={{ width: "100%", marginTop: 24 }} size="large">
            <div>
              <Typography.Text strong>正在生成章节...</Typography.Text>
              <Progress percent={progress} status="active" />
            </div>
          </Space>
        )}

        {sections.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <Typography.Title level={4}>已生成章节</Typography.Title>
            {sections
              .sort((a, b) => a.order - b.order)
              .map((section) => (
                <Card
                  key={section.order}
                  size="small"
                  title={`${section.order}. ${section.title}`}
                  style={{ marginBottom: 16 }}
                >
                  <ReactMarkdown>{section.markdown}</ReactMarkdown>
                </Card>
              ))}
          </div>
        )}

        {downloadUrl && reportId && (
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <Button
              type="primary"
              size="large"
              onClick={() => {
                window.open(`${import.meta.env.VITE_API_BASE_URL}${downloadUrl}`, "_blank");
              }}
            >
              下载 PDF 报告
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
