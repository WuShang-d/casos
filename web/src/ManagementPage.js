import React, {useState} from "react";
import {Link, Redirect, Route, Switch, withRouter} from "react-router-dom";
import {Layout, Menu, Typography} from "antd";
import {AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined} from "@ant-design/icons";
import Sider from "antd/es/layout/Sider";
import {Content, Header} from "antd/es/layout/layout";
import * as Setting from "./Setting";
import PodListPage from "./PodListPage";
import ConfigMapListPage from "./ConfigMapListPage";
import NamespaceListPage from "./NamespaceListPage";
import NodeListPage from "./NodeListPage";
import ServiceAccountListPage from "./ServiceAccountListPage";
import ServiceListPage from "./ServiceListPage";

const {Text} = Typography;

function getMenuItems() {
  return [
    Setting.getItem(
      <Link to="/pods">Workloads</Link>,
      "/workloads",
      <AppstoreOutlined />,
      [
        Setting.getItem(<Link to="/pods">Pods</Link>, "/pods"),
      ]
    ),
    Setting.getItem(
      <Link to="/nodes">Cluster</Link>,
      "/cluster",
      <AppstoreOutlined />,
      [
        Setting.getItem(<Link to="/nodes">Nodes</Link>, "/nodes"),
        Setting.getItem(<Link to="/namespaces">Namespaces</Link>, "/namespaces"),
        Setting.getItem(<Link to="/serviceaccounts">Service Accounts</Link>, "/serviceaccounts"),
      ]
    ),
    Setting.getItem(
      <Link to="/configmaps">Configuration</Link>,
      "/configuration",
      <AppstoreOutlined />,
      [
        Setting.getItem(<Link to="/configmaps">ConfigMaps</Link>, "/configmaps"),
      ]
    ),
    Setting.getItem(
      <Link to="/services">Networking</Link>,
      "/networking",
      <AppstoreOutlined />,
      [
        Setting.getItem(<Link to="/services">Services</Link>, "/services"),
      ]
    ),
  ];
}

const pathToGroup = {
  "/pods": "/workloads",
  "/nodes": "/cluster",
  "/namespaces": "/cluster",
  "/serviceaccounts": "/cluster",
  "/configmaps": "/configuration",
  "/services": "/networking",
};

function ManagementPage(props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("siderCollapsed") === "true");

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("siderCollapsed", String(next));
  };

  const uri = props.location?.pathname ?? "/";
  const selectedKey = "/" + (uri.split("/").filter(Boolean)[0] || "pods");
  const openKey = pathToGroup[selectedKey] ?? "/workloads";

  return (
    <Layout style={{minHeight: "100vh"}}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={200}
        style={{overflow: "auto", height: "100vh", position: "fixed", left: 0, top: 0, bottom: 0}}
      >
        <div style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: collapsed ? 18 : 20,
          fontWeight: "bold",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}>
          {collapsed ? "C" : "CasOS"}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={[openKey]}
          items={getMenuItems()}
        />
      </Sider>

      <Layout style={{marginLeft: collapsed ? 80 : 200, transition: "margin-left 0.2s"}}>
        <Header style={{
          padding: "0 16px",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}>
          <div style={{display: "flex", alignItems: "center", gap: 16}}>
            {collapsed
              ? <MenuUnfoldOutlined onClick={toggleCollapsed} style={{fontSize: 18, cursor: "pointer"}} />
              : <MenuFoldOutlined onClick={toggleCollapsed} style={{fontSize: 18, cursor: "pointer"}} />
            }
          </div>
          <Text type="secondary" style={{fontSize: 12}}>CasOS Control Plane</Text>
        </Header>

        <Content style={{margin: "24px 16px", padding: 24, background: "#fff", borderRadius: 8}}>
          <Switch>
            <Redirect exact from="/" to="/nodes" />
            <Route exact path="/pods" render={(props) => <PodListPage {...props} />} />
            <Route exact path="/nodes" render={(props) => <NodeListPage {...props} />} />
            <Route exact path="/namespaces" render={(props) => <NamespaceListPage {...props} />} />
            <Route exact path="/serviceaccounts" render={(props) => <ServiceAccountListPage {...props} />} />
            <Route exact path="/configmaps" render={(props) => <ConfigMapListPage {...props} />} />
            <Route exact path="/services" render={(props) => <ServiceListPage {...props} />} />
          </Switch>
        </Content>
      </Layout>
    </Layout>
  );
}

export default withRouter(ManagementPage);
