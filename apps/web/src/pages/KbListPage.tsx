import { Button, Card, Form, Input, List, Modal, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../lib/api";

type Kb = { id: string; name: string; description?: string | null };

export default function KbListPage() {
  const [items, setItems] = useState<Kb[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const navigate = useNavigate();

  async function refresh() {
    const data = await apiFetch<Kb[]>("/kb");
    setItems(data);
  }

  useEffect(() => {
    refresh().catch((e) => message.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          知识库
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          新建知识库
        </Button>
      </div>

      <Card>
        <List
          dataSource={items}
          renderItem={(kb) => (
            <List.Item
              actions={[
                <Button key="docs" type="link" onClick={() => navigate(`/kb/${kb.id}/documents`)}>
                  文档管理
                </Button>,
              ]}
            >
              <List.Item.Meta title={kb.name} description={kb.description || "-"} />
            </List.Item>
          )}
        />
      </Card>

      <Modal title="新建知识库" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnClose>
        <Form
          layout="vertical"
          onFinish={async (values) => {
            try {
              await apiFetch("/kb", { method: "POST", body: JSON.stringify(values) });
              message.success("创建成功");
              setOpen(false);
              await refresh();
            }
            catch (e) {
              message.error(e instanceof Error ? e.message : "创建失败");
            }
          }}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            创建
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
