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
      message.error(e instanceof Error ? e.message : "Failed to load knowledge bases");
    }
  }

  async function generateReport(values: any) {
    setSections([]);
    setProgress(0);
    setDownloadUrl(null);
    setReportId(null);
    setGenerating(true);

    const totalSections = 5; // Fixed outline has 5 sections

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/reports/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error("Report generation request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            const event = line.slice(6).trim();
            const nextLine = lines.shift();
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
                message.success("Report generated successfully!");
                setGenerating(false);
              }
              else if (event === "error") {
                message.error(data.message || "Report generation error");
                setGenerating(false);
              }
            }
          }
        }
      }
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "Report generation failed");
      setGenerating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Generate Research Report
        </Typography.Title>

        <Form layout="vertical" onFinish={generateReport}>
          <Form.Item
            label="Knowledge Base"
            name="kbId"
            rules={[{ required: true, message: "Please select a knowledge base" }]}
          >
            <Select placeholder="Select a knowledge base">
              {kbs.map((kb) => (
                <Select.Option key={kb.id} value={kb.id}>
                  {kb.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="Research Topic"
            name="topic"
            rules={[{ required: true, message: "Please enter a research topic" }]}
          >
            <Input placeholder="e.g., Project-Based Learning in STEM Education" />
          </Form.Item>

          <Form.Item label="Grade Level (Optional)" name="gradeLevel">
            <Input placeholder="e.g., High School, Middle School" />
          </Form.Item>

          <Form.Item label="Subject (Optional)" name="subject">
            <Input placeholder="e.g., Mathematics, Science" />
          </Form.Item>

          <Form.Item label="Research Duration (Optional)" name="researchDuration">
            <Input placeholder="e.g., 6 months, 1 year" />
          </Form.Item>

          <Form.Item label="Research Questions (Optional)" name="researchQuestions">
            <Input.TextArea rows={3} placeholder="Enter specific research questions to address..." />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={generating} disabled={generating} block>
              Generate Report
            </Button>
          </Form.Item>
        </Form>

        {generating && (
          <Space direction="vertical" style={{ width: "100%", marginTop: 24 }} size="large">
            <div>
              <Typography.Text strong>Generating sections...</Typography.Text>
              <Progress percent={progress} status="active" />
            </div>
          </Space>
        )}

        {sections.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <Typography.Title level={4}>Generated Sections</Typography.Title>
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
                window.open(`${import.meta.env.VITE_API_URL}${downloadUrl}`, "_blank");
              }}
            >
              Download PDF Report
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
