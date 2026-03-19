import { Button, Card, Col, Input, List, Row, Tag, Typography, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

type Document = {
  id: string;
  filename: string;
  status: string;
  error?: string | null;
  createdAt: string;
};

type SearchResult = {
  score: number;
  text: string;
  filename: string;
  documentId: string;
  chunkIndex: number;
};

function getToken(): string | null {
  return localStorage.getItem("accessToken");
}

function getStatusTag(status: string) {
  const statusConfig: Record<string, { color: string; text: string }> = {
    UPLOADED: { color: "blue", text: "已上传" },
    PARSING: { color: "orange", text: "解析中" },
    EMBEDDING: { color: "cyan", text: "向量化中" },
    READY: { color: "green", text: "就绪" },
    FAILED: { color: "red", text: "失败" },
  };
  const config = statusConfig[status] || { color: "default", text: status };
  return <Tag color={config.color}>{config.text}</Tag>;
}

export default function DocumentsPage() {
  const { kbId } = useParams<{ kbId: string }>();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function fetchDocuments() {
    const token = getToken();
    const res = await fetch(`${API_BASE_URL}/kb/${kbId}/documents`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error("Failed to fetch documents");
    }
    const data = await res.json();
    setDocuments(data);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      message.warning("请输入检索关键词");
      return;
    }

    setSearching(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}/kb/${kbId}/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: searchQuery, topK }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Search failed");
      }

      const results = await res.json();
      setSearchResults(results);
      message.success(`找到 ${results.length} 个相关片段`);
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "检索失败");
    }
    finally {
      setSearching(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}/documents/${id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Delete failed");
      }

      message.success("删除成功");
      await fetchDocuments();
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  useEffect(() => {
    fetchDocuments().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, [kbId]);

  return (
    <div style={{ maxWidth: 1200 }}>
      <Typography.Title level={3}>文档管理</Typography.Title>

      <Row gutter={24}>
        <Col span={14}>
          <Card
            title="文档列表"
            extra={(
              <Upload
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    const formData = new FormData();
                    formData.append("file", file as File);

                    const token = getToken();
                    const res = await fetch(`${API_BASE_URL}/kb/${kbId}/documents/upload`, {
                      method: "POST",
                      headers: {
                        authorization: `Bearer ${token}`,
                      },
                      body: formData,
                    });

                    if (!res.ok) {
                      const data = await res.json();
                      throw new Error(data.message || "Upload failed");
                    }

                    message.success("上传成功，正在处理...");
                    onSuccess?.(null);
                    await fetchDocuments();
                  }
                  catch (e) {
                    message.error(e instanceof Error ? e.message : "上传失败");
                    onError?.(e as Error);
                  }
                }}
              >
                <Button type="primary" icon={<UploadOutlined />}>
                  上传文档
                </Button>
              </Upload>
            )}
          >
            <List
              dataSource={documents}
              renderItem={(doc) => (
                <List.Item
                  actions={[
                    <Button key="delete" type="link" danger onClick={() => handleDelete(doc.id)}>
                      删除
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={(
                      <div>
                        {doc.filename} {getStatusTag(doc.status)}
                      </div>
                    )}
                    description={doc.error ? <span style={{ color: "red" }}>{doc.error}</span> : null}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col span={10}>
          <Card title="检索测试">
            <Input.Search
              placeholder="输入查询关键词"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearch}
              loading={searching}
              enterButton="检索"
              style={{ marginBottom: 12 }}
            />

            <div style={{ marginBottom: 12 }}>
              <span>返回数量：</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                style={{ width: 80, marginLeft: 8 }}
              />
            </div>

            {searchResults.length > 0 && (
              <div>
                <Typography.Title level={5} style={{ marginTop: 16 }}>
                  检索结果
                </Typography.Title>
                <List
                  size="small"
                  dataSource={searchResults}
                  renderItem={(result, index) => (
                    <List.Item>
                      <List.Item.Meta
                        title={(
                          <div>
                            #{index + 1} 相似度: {(result.score * 100).toFixed(1)}%
                          </div>
                        )}
                        description={(
                          <div>
                            <div style={{ fontSize: 12, color: "#888" }}>
                              {result.filename} (chunk {result.chunkIndex})
                            </div>
                            <div style={{ marginTop: 4, fontSize: 13 }}>
                              {result.text.substring(0, 150)}
                              {result.text.length > 150 ? "..." : ""}
                            </div>
                          </div>
                        )}
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
