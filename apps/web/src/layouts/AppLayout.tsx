import { FileTextOutlined, LoginOutlined, MessageOutlined, DatabaseOutlined } from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const loc = useLocation();
  const nav = useNavigate();

  const userRaw = localStorage.getItem("user");
  const user = userRaw ? (JSON.parse(userRaw) as { username: string; role: string }) : null;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={220}>
        <div style={{ padding: 16 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            课题助手
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user ? `${user.username} (${user.role})` : "未登录"}
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={[
            { key: "/kb", icon: <DatabaseOutlined />, label: <Link to="/kb">知识库</Link> },
            { key: "/chat", icon: <MessageOutlined />, label: <Link to="/chat">聊天</Link> },
            { key: "/reports/new", icon: <FileTextOutlined />, label: <Link to="/reports/new">生成报告</Link> },
            {
              key: "logout",
              icon: <LoginOutlined />,
              label: "退出登录",
              onClick: () => {
                localStorage.removeItem("accessToken");
                localStorage.removeItem("user");
                nav("/login");
              },
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }} />
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
