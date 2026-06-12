import React from "react";
import { ConfigProvider, Layout, Typography } from "antd";
import PodList from "./PodList";

const { Header, Content } = Layout;
const { Title } = Typography;

export default function App() {
  return (
    <ConfigProvider>
      <Layout style={{ minHeight: "100vh" }}>
        <Header style={{ display: "flex", alignItems: "center" }}>
          <Title level={4} style={{ color: "#fff", margin: 0 }}>
            Casos — Control Plane
          </Title>
        </Header>
        <Content style={{ padding: "24px" }}>
          <PodList />
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
