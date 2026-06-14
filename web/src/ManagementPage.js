import React, {useEffect, useRef, useState} from "react";
import {Link, Redirect, Route, Switch, withRouter} from "react-router-dom";
import {Avatar, Button, Card, Dropdown, Layout, Menu, Result} from "antd";
import {
  AppstoreOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DownOutlined,
  LockOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NodeIndexOutlined,
  SafetyOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import * as Setting from "./Setting";
import LanguageSelect from "./LanguageSelect";
import PodListPage from "./PodListPage";
import ConfigMapListPage from "./ConfigMapListPage";
import NamespaceListPage from "./NamespaceListPage";
import NodeListPage from "./NodeListPage";
import ServiceAccountListPage from "./ServiceAccountListPage";
import ServiceListPage from "./ServiceListPage";
import ClusterRoleBindingListPage from "./ClusterRoleBindingListPage";

const {Header, Footer, Content, Sider} = Layout;

function getMenuParentKey(uri) {
  if (!uri) {return null;}
  if (uri.includes("/pods")) {return "/workloads";}
  if (uri.includes("/nodes") || uri.includes("/namespaces") || uri.includes("/serviceaccounts")) {return "/cluster";}
  if (uri.includes("/configmaps")) {return "/configuration";}
  if (uri.includes("/services")) {return "/networking";}
  if (uri.includes("/clusterrolebindings")) {return "/accesscontrol";}
  return null;
}

const siderMenuOpenKeysLsKey = "siderMenuOpenKeys";
const defaultMenuOpenKeys = ["/workloads", "/cluster", "/configuration", "/networking", "/accesscontrol"];

function readSavedMenuOpenKeys() {
  try {
    const raw = localStorage.getItem(siderMenuOpenKeysLsKey);
    if (!raw) {return defaultMenuOpenKeys;}
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : defaultMenuOpenKeys;
  } catch {
    return defaultMenuOpenKeys;
  }
}

function persistMenuOpenKeys(keys) {
  try {
    localStorage.setItem(siderMenuOpenKeysLsKey, JSON.stringify(keys));
  } catch {
    // ignore
  }
}

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
      <ClusterOutlined />,
      [
        Setting.getItem(<Link to="/nodes">Nodes</Link>, "/nodes"),
        Setting.getItem(<Link to="/namespaces">Namespaces</Link>, "/namespaces"),
        Setting.getItem(<Link to="/serviceaccounts">Service Accounts</Link>, "/serviceaccounts"),
      ]
    ),
    Setting.getItem(
      <Link to="/configmaps">Configuration</Link>,
      "/configuration",
      <SettingOutlined />,
      [
        Setting.getItem(<Link to="/configmaps">ConfigMaps</Link>, "/configmaps"),
      ]
    ),
    Setting.getItem(
      <Link to="/services">Networking</Link>,
      "/networking",
      <NodeIndexOutlined />,
      [
        Setting.getItem(<Link to="/services">Services</Link>, "/services"),
      ]
    ),
    Setting.getItem(
      <Link to="/clusterrolebindings">Access Control</Link>,
      "/accesscontrol",
      <LockOutlined />,
      [
        Setting.getItem(<Link to="/clusterrolebindings">ClusterRoleBindings</Link>, "/clusterrolebindings"),
      ]
    ),
  ];
}

function ManagementPage(props) {
  const [siderCollapsed, setSiderCollapsed] = useState(() => localStorage.getItem("siderCollapsed") === "true");
  const siderWasCollapsedRef = useRef(false);
  const [menuOpenKeys, setMenuOpenKeys] = useState(() => {
    if (localStorage.getItem("siderCollapsed") === "true") {
      return [];
    }
    const saved = readSavedMenuOpenKeys();
    // eslint-disable-next-line no-restricted-globals
    const parentKey = getMenuParentKey(props.uri || location.pathname);
    const next = new Set(saved);
    if (parentKey) {next.add(parentKey);}
    return [...next];
  });

  useEffect(() => {
    if (siderCollapsed) {
      siderWasCollapsedRef.current = true;
      setMenuOpenKeys([]);
      return;
    }
    const justExpanded = siderWasCollapsedRef.current;
    siderWasCollapsedRef.current = false;
    const parentKey = getMenuParentKey(props.uri);
    setMenuOpenKeys(prev => {
      if (justExpanded) {
        const saved = readSavedMenuOpenKeys();
        const next = new Set(saved);
        if (parentKey) {next.add(parentKey);}
        return [...next];
      }
      if (parentKey && !prev.includes(parentKey)) {
        return [...prev, parentKey];
      }
      return prev;
    });
  }, [props.uri, siderCollapsed]);

  useEffect(() => {
    if (!siderCollapsed) {
      persistMenuOpenKeys(menuOpenKeys);
    }
  }, [menuOpenKeys, siderCollapsed]);

  const {uri, history, account, onSignout} = props;

  function getAvatarColor(s) {
    const colorList = ["#f56a00", "#7265e6", "#ffbf00", "#00a2ae"];
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash;
    }
    return colorList[Math.abs(hash) % 4];
  }

  function renderAvatar() {
    if (!account) {return null;}
    if (account.avatar) {
      return <Avatar src={account.avatar} size="default" style={{verticalAlign: "middle"}} />;
    }
    const name = account.name || "?";
    return (
      <Avatar size="default" style={{backgroundColor: getAvatarColor(name), verticalAlign: "middle"}}>
        {name.slice(0, 1).toUpperCase()}
      </Avatar>
    );
  }

  function renderAccountDropdown() {
    if (!account) {return null;}
    const items = [
      {
        key: "account",
        icon: <UserOutlined />,
        label: "My Account",
        onClick: () => window.open(Setting.getMyProfileUrl(account), "_blank"),
      },
      {
        key: "signout",
        icon: <LogoutOutlined />,
        label: "Sign Out",
        onClick: onSignout,
      },
    ];
    return (
      <Dropdown menu={{items}} placement="bottomRight">
        <div style={{display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "0 8px"}}>
          {renderAvatar()}
          <span style={{fontSize: 14, color: "#18181b"}}>{account.displayName || account.name}</span>
          <DownOutlined style={{fontSize: 11, color: "#a3a3a3"}} />
        </div>
      </Dropdown>
    );
  }

  // eslint-disable-next-line no-restricted-globals
  const currentUri = uri || location.pathname;
  const firstSeg = currentUri.split("/").filter(Boolean)[0] || "nodes";
  const selectedLeafKey = "/" + firstSeg;

  const toggleSider = () => {
    const next = !siderCollapsed;
    setSiderCollapsed(next);
    localStorage.setItem("siderCollapsed", String(next));
  };

  function renderRouter() {
    return (
      <Switch>
        <Redirect exact from="/" to="/nodes" />
        <Route exact path="/pods" render={(props) => <PodListPage {...props} />} />
        <Route exact path="/nodes" render={(props) => <NodeListPage {...props} />} />
        <Route exact path="/namespaces" render={(props) => <NamespaceListPage {...props} />} />
        <Route exact path="/serviceaccounts" render={(props) => <ServiceAccountListPage {...props} />} />
        <Route exact path="/configmaps" render={(props) => <ConfigMapListPage {...props} />} />
        <Route exact path="/services" render={(props) => <ServiceListPage {...props} />} />
        <Route exact path="/clusterrolebindings" render={(props) => <ClusterRoleBindingListPage {...props} />} />
        <Route path="" render={() => <Result status="404" title="404 NOT FOUND" subTitle="Sorry, the page you visited does not exist." extra={<a href="/"><Button type="primary">Back Home</Button></a>} />} />
      </Switch>
    );
  }

  const siderWidth = 256;
  const siderCollapsedWidth = 80;

  return (
    <React.Fragment>
      <Sider
        collapsed={siderCollapsed}
        collapsedWidth={siderCollapsedWidth}
        width={siderWidth}
        trigger={null}
        theme="light"
        style={{
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          boxShadow: "none",
          borderRight: "1px solid #eaedf3",
          background: "#fafbfc",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{
          height: 52,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: siderCollapsed ? "center" : "flex-start",
          padding: siderCollapsed ? "0" : "0 16px 0 24px",
          overflow: "hidden",
          borderBottom: "1px solid #eaedf3",
        }}>
          <Link to="/" style={{display: "flex", alignItems: "center", gap: 8, textDecoration: "none"}}>
            <SafetyOutlined style={{fontSize: siderCollapsed ? 22 : 20, color: "#404040"}} />
            {!siderCollapsed && (
              <span style={{fontSize: 16, fontWeight: 700, color: "#18181b", letterSpacing: "-0.01em"}}>CasOS</span>
            )}
          </Link>
        </div>
        <div className="sider-menu-container" style={{flex: 1, overflow: "auto", paddingTop: "6px"}}>
          <Menu
            mode="inline"
            items={getMenuItems()}
            selectedKeys={[selectedLeafKey]}
            openKeys={menuOpenKeys}
            onOpenChange={setMenuOpenKeys}
            theme="light"
            style={{borderRight: 0, background: "#fafbfc"}}
          />
        </div>
      </Sider>

      <div style={{marginLeft: siderCollapsed ? siderCollapsedWidth : siderWidth, transition: "margin-left 0.2s", display: "flex", flexDirection: "column", minHeight: "100vh"}}>
        <Header style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 0 0", marginBottom: "0", backgroundColor: "#ffffff", position: "sticky", top: 0, zIndex: 99, borderBottom: "1px solid #f0f0f0", boxShadow: "none", height: "52px", lineHeight: "52px"}}>
          <div style={{display: "flex", alignItems: "center"}}>
            <Button
              icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleSider}
              type="text"
              style={{fontSize: 16, width: 40, height: 40}}
            />
          </div>
          <div style={{display: "flex", alignItems: "center", gap: 8}}>
            <LanguageSelect />
            {renderAccountDropdown()}
          </div>
        </Header>

        <Content style={{display: "flex", flexDirection: "column"}}>
          <Card className="content-warp-card" styles={{body: {padding: 0, margin: 0}}}>
            {renderRouter()}
          </Card>
        </Content>

        <Footer style={{textAlign: "center", height: "67px", lineHeight: "67px", fontSize: 12, color: "#a3a3a3"}}>
          CasOS ©{new Date().getFullYear()}
        </Footer>
      </div>
    </React.Fragment>
  );
}

export default withRouter(ManagementPage);
