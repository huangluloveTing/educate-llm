import { Button, Card, Form, Input, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../lib/api";

type LoginResp = {
  accessToken: string;
  user: { id: string; username: string; role: "ADMIN" | "TEACHER" };
};

export default function LoginPage() {
  const nav = useNavigate();

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          教育课题助手
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          使用管理员账号 <b>admin / admin123456</b> 登录。
        </Typography.Paragraph>

        <Form
          layout="vertical"
          onFinish={async (values) => {
            try {
              const data = await apiFetch<LoginResp>("/auth/login", {
                method: "POST",
                body: JSON.stringify(values),
              });
              localStorage.setItem("accessToken", data.accessToken);
              localStorage.setItem("user", JSON.stringify(data.user));
              message.success("登录成功");
              nav("/kb");
            }
            catch (e) {
              message.error(e instanceof Error ? e.message : "登录失败");
            }
          }}
        >
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
