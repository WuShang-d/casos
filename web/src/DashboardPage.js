import React, {useEffect, useMemo, useRef, useState} from "react";
import {Alert, Card, Col, Progress, Row, Spin, Statistic, Table, Tag} from "antd";
import {useHistory} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  WarningOutlined
} from "@ant-design/icons";
import * as echarts from "echarts";
import * as DashboardBackend from "./backend/DashboardBackend";
import * as Setting from "./Setting";

// Blue-family multi-hue palette, same as casdoor
const CHART_COLORS = [
  "#1677ff",
  "#0ea5e9",
  "#06b6d4",
  "#14b8a6",
  "#6366f1",
  "#8b5cf6",
  "#0958d9",
  "#0284c7",
  "#0891b2",
  "#0f766e",
  "#5734d3",
  "#7c3aed",
  "#38bdf8",
  "#5eead4",
];

const POD_PHASE_COLORS = {
  Running: "#1677ff",
  Pending: "#0ea5e9",
  Succeeded: "#14b8a6",
  Failed: "#6366f1",
  Unknown: "#8b5cf6",
};

const SVC_TYPE_COLORS = {
  ClusterIP: "#1677ff",
  NodePort: "#06b6d4",
  LoadBalancer: "#6366f1",
  ExternalName: "#14b8a6",
};

// Reusable ECharts container — same pattern as casdoor
const EchartsWidget = React.memo(({option, style}) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) {return;}
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, {notMerge: true});
    }
  }, [option]);

  return <div ref={containerRef} style={style} />;
});

EchartsWidget.displayName = "EchartsWidget";

function formatMiB(mib) {
  if (mib >= 1024) {return `${(mib / 1024).toFixed(1)} GiB`;}
  return `${mib} MiB`;
}

function buildPodPhaseOption(podsByPhase) {
  if (!podsByPhase) {return null;}
  const data = Object.entries(podsByPhase).map(([name, value]) => ({
    name,
    value,
    itemStyle: {color: POD_PHASE_COLORS[name] || "#8b5cf6"},
  }));
  return {
    tooltip: {trigger: "item", formatter: "{b}: {c} ({d}%)"},
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 8,
      left: "56%",
      top: "center",
      textStyle: {fontSize: 12},
    },
    series: [{
      type: "pie",
      radius: ["42%", "68%"],
      center: ["28%", "50%"],
      avoidLabelOverlap: true,
      itemStyle: {borderRadius: 5, borderColor: "#fff", borderWidth: 2},
      label: {show: false},
      emphasis: {
        label: {show: true, fontSize: 13, fontWeight: "bold"},
        itemStyle: {shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.2)"},
      },
      data,
    }],
  };
}

function buildSvcTypeOption(servicesByType) {
  if (!servicesByType) {return null;}
  const data = Object.entries(servicesByType).map(([name, value]) => ({
    name,
    value,
    itemStyle: {color: SVC_TYPE_COLORS[name] || "#38bdf8"},
  }));
  return {
    tooltip: {trigger: "item", formatter: "{b}: {c} ({d}%)"},
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 8,
      left: "56%",
      top: "center",
      textStyle: {fontSize: 12},
    },
    series: [{
      type: "pie",
      radius: ["42%", "68%"],
      center: ["28%", "50%"],
      avoidLabelOverlap: true,
      itemStyle: {borderRadius: 5, borderColor: "#fff", borderWidth: 2},
      label: {show: false},
      emphasis: {
        label: {show: true, fontSize: 13, fontWeight: "bold"},
        itemStyle: {shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.2)"},
      },
      data,
    }],
  };
}

function buildPodsByNsOption(podsByNamespace) {
  if (!podsByNamespace) {return null;}
  const sorted = Object.entries(podsByNamespace)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const names = sorted.map(([ns]) => ns);
  const values = sorted.map(([, v]) => v);
  return {
    color: CHART_COLORS,
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "shadow"},
      formatter: (params) => `${params[0].name}<br/>Pods: <b>${params[0].value}</b>`,
    },
    grid: {left: 16, right: 24, top: 8, bottom: 8, containLabel: true},
    xAxis: {type: "value", minInterval: 1, axisLabel: {fontSize: 11}},
    yAxis: {
      type: "category",
      data: names,
      axisLabel: {
        fontSize: 11,
        formatter: (v) => v.length > 20 ? v.slice(0, 18) + "…" : v,
      },
    },
    series: [{
      type: "bar",
      data: values.map((v, i) => ({
        value: v,
        itemStyle: {color: CHART_COLORS[i % CHART_COLORS.length], borderRadius: [0, 4, 4, 0]},
      })),
    }],
  };
}

function buildNodeInfraOption(nodesByOS, nodesByArch) {
  const osData = Object.entries(nodesByOS || {}).map(([name, value], i) => ({
    name,
    value,
    itemStyle: {color: CHART_COLORS[i % CHART_COLORS.length]},
  }));
  const archData = Object.entries(nodesByArch || {}).map(([name, value], i) => ({
    name,
    value,
    itemStyle: {color: CHART_COLORS[(i + 4) % CHART_COLORS.length]},
  }));
  return {
    tooltip: {trigger: "item", formatter: "{a}<br/>{b}: {c} ({d}%)"},
    legend: {
      data: [...osData.map(d => d.name), ...archData.map(d => d.name)],
      bottom: 0,
      textStyle: {fontSize: 11},
    },
    series: [
      {
        name: "OS",
        type: "pie",
        radius: ["20%", "40%"],
        center: ["30%", "45%"],
        label: {position: "inner", fontSize: 11, color: "#fff"},
        itemStyle: {borderRadius: 4, borderColor: "#fff", borderWidth: 2},
        data: osData,
      },
      {
        name: "Arch",
        type: "pie",
        radius: ["20%", "40%"],
        center: ["70%", "45%"],
        label: {position: "inner", fontSize: 11, color: "#fff"},
        itemStyle: {borderRadius: 4, borderColor: "#fff", borderWidth: 2},
        data: archData,
      },
    ],
  };
}

function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const history = useHistory();
  const {t} = useTranslation();

  const reasonLabels = {
    "CrashLoopBackOff": {text: t("dashboard:reason CrashLoopBackOff"), color: "red"},
    "OOMKilled": {text: t("dashboard:reason OOMKilled"), color: "volcano"},
    "ImagePullBackOff": {text: t("dashboard:reason ImagePullBackOff"), color: "orange"},
    "ErrImagePull": {text: t("dashboard:reason ImagePullBackOff"), color: "orange"},
    "InvalidImageName": {text: t("dashboard:reason InvalidImageName"), color: "orange"},
    "CreateContainerConfigError": {text: t("dashboard:reason ConfigError"), color: "gold"},
    "CreateContainerError": {text: t("dashboard:reason ContainerError"), color: "gold"},
    "Evicted": {text: t("dashboard:reason Evicted"), color: "purple"},
    "Failed": {text: t("dashboard:reason Failed"), color: "red"},
    "Unknown": {text: t("dashboard:reason Unknown"), color: "default"},
  };

  const unhealthyColumns = [
    {title: t("dashboard:col Namespace"), dataIndex: "namespace", key: "namespace", width: 160},
    {title: t("dashboard:col App name"), dataIndex: "name", key: "name"},
    {
      title: t("dashboard:col Status"),
      dataIndex: "reason",
      key: "reason",
      render: (reason) => {
        const label = reasonLabels[reason] || {text: reason, color: "default"};
        return <Tag color={label.color}>{label.text}</Tag>;
      },
    },
  ];

  useEffect(() => {
    DashboardBackend.getDashboard().then(res => {
      setLoading(false);
      if (res.status === "ok") {
        setStats(res.data);
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(err => {
      setLoading(false);
      Setting.showMessage("error", `Failed to load dashboard: ${err}`);
    });
  }, []);

  const podPhaseOption = useMemo(() => buildPodPhaseOption(stats?.podsByPhase), [stats]);
  const svcTypeOption = useMemo(() => buildSvcTypeOption(stats?.servicesByType), [stats]);
  const podsByNsOption = useMemo(() => buildPodsByNsOption(stats?.podsByNamespace), [stats]);
  const nodeInfraOption = useMemo(() => buildNodeInfraOption(stats?.nodesByOS, stats?.nodesByArch), [stats]);

  if (loading) {
    return (
      <div style={{display: "flex", justifyContent: "center", alignItems: "center", height: 400}}>
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) {return null;}

  const nodeReadyRate = stats.nodesTotal > 0
    ? parseFloat((stats.nodesReady / stats.nodesTotal * 100).toFixed(1))
    : 0;
  const podRunningRate = stats.podsTotal > 0
    ? parseFloat((stats.podsRunning / stats.podsTotal * 100).toFixed(1))
    : 0;

  const cardStyle = {borderRadius: 8, border: "1px solid #e8e8e8", minHeight: 110};
  const gutter = [16, 16];

  const unhealthyPods = stats.unhealthyPods || [];

  return (
    <div style={{padding: 24}}>

      {/* Unhealthy alert banner */}
      {unhealthyPods.length > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{marginBottom: 16, borderRadius: 8, cursor: "pointer"}}
          message={
            <span style={{fontWeight: 600}}>
              {t("dashboard:alert unhealthy", {count: unhealthyPods.length})}
            </span>
          }
          description={
            <Table
              size="small"
              dataSource={unhealthyPods.map((p, i) => ({...p, key: i}))}
              columns={unhealthyColumns}
              pagination={false}
              style={{marginTop: 8, background: "transparent"}}
              onRow={(record) => ({
                onClick: () => history.push(`/pods?namespace=${record.namespace}`),
                style: {cursor: "pointer"},
              })}
            />
          }
        />
      )}
      {unhealthyPods.length === 0 && (
        <Alert
          type="success"
          showIcon
          message={t("dashboard:alert healthy")}
          style={{marginBottom: 16, borderRadius: 8}}
        />
      )}

      {/* Row 1 — stat cards */}
      <Row gutter={gutter}>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Nodes total")}
              value={stats.nodesTotal}
              prefix={<ClusterOutlined style={{color: "#1677ff"}} />}
              valueStyle={{color: "#1677ff"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Nodes ready")}
              value={stats.nodesReady}
              prefix={<CheckCircleOutlined style={{color: "#14b8a6"}} />}
              valueStyle={{color: "#14b8a6"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Pods total")}
              value={stats.podsTotal}
              prefix={<AppstoreOutlined style={{color: "#0958d9"}} />}
              valueStyle={{color: "#0958d9"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Pods running")}
              value={stats.podsRunning}
              prefix={<AppstoreOutlined style={{color: "#0ea5e9"}} />}
              valueStyle={{color: "#0ea5e9"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Namespaces")}
              value={stats.namespacesTotal}
              prefix={<SettingOutlined style={{color: "#6366f1"}} />}
              valueStyle={{color: "#6366f1"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Services")}
              value={stats.servicesTotal}
              prefix={<NodeIndexOutlined style={{color: "#8b5cf6"}} />}
              valueStyle={{color: "#8b5cf6"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title={t("dashboard:stat Deployments total")}
              value={stats.deploymentsTotal}
              prefix={<AppstoreOutlined style={{color: "#0891b2"}} />}
              valueStyle={{color: "#0891b2"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={{
            ...cardStyle,
            borderColor: stats.deploymentsAvailable < stats.deploymentsTotal ? "#ff4d4f" : "#e8e8e8",
          }}>
            <Statistic
              title={t("dashboard:stat Deployments available")}
              value={stats.deploymentsAvailable}
              suffix={`/ ${stats.deploymentsTotal}`}
              prefix={<CheckCircleOutlined style={{color: stats.deploymentsAvailable < stats.deploymentsTotal ? "#ff4d4f" : "#14b8a6"}} />}
              valueStyle={{color: stats.deploymentsAvailable < stats.deploymentsTotal ? "#ff4d4f" : "#14b8a6"}}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 1b — Cluster CPU / Memory usage (shown only when metrics-server is available) */}
      {(stats.clusterCPUTotalM > 0 || stats.clusterMemTotalMi > 0) && (
        <Row gutter={gutter} style={{marginTop: 16}}>
          <Col xs={24} md={12}>
            <Card variant="borderless" style={cardStyle}>
              <div style={{marginBottom: 6, fontWeight: 500, color: "#595959"}}>CPU</div>
              <div style={{display: "flex", alignItems: "center", gap: 12}}>
                <Progress
                  percent={stats.clusterCPUTotalM > 0 ? Math.round(stats.clusterCPUUsedM / stats.clusterCPUTotalM * 100) : 0}
                  strokeColor={{"0%": "#0958d9", "100%": "#1677ff"}}
                  style={{flex: 1}}
                />
                <span style={{fontSize: 13, color: "#595959", whiteSpace: "nowrap"}}>
                  {(stats.clusterCPUUsedM / 1000).toFixed(2)} / {(stats.clusterCPUTotalM / 1000).toFixed(2)} cores
                </span>
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card variant="borderless" style={cardStyle}>
              <div style={{marginBottom: 6, fontWeight: 500, color: "#595959"}}>Memory</div>
              <div style={{display: "flex", alignItems: "center", gap: 12}}>
                <Progress
                  percent={stats.clusterMemTotalMi > 0 ? Math.round(stats.clusterMemUsedMi / stats.clusterMemTotalMi * 100) : 0}
                  strokeColor={{"0%": "#06b6d4", "100%": "#14b8a6"}}
                  style={{flex: 1}}
                />
                <span style={{fontSize: 13, color: "#595959", whiteSpace: "nowrap"}}>
                  {formatMiB(stats.clusterMemUsedMi)} / {formatMiB(stats.clusterMemTotalMi)}
                </span>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {/* Row 2 — Pods by namespace (bar) + Pod phase (donut) */}
      <Row gutter={gutter} style={{marginTop: 16}}>
        <Col xs={24} xl={14}>
          <Card
            title={t("dashboard:chart Pods by namespace")}
            variant="borderless"
            style={cardStyle}
          >
            <EchartsWidget
              option={podsByNsOption}
              style={{height: 280}}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title={t("dashboard:chart Pod phase")}
            variant="borderless"
            style={{...cardStyle, height: "100%"}}
          >
            <EchartsWidget
              option={podPhaseOption}
              style={{height: 280}}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 3 — Node health circle + Service type donut + Node infra */}
      <Row gutter={gutter} style={{marginTop: 16}}>
        <Col xs={24} xl={7}>
          <Card
            title={t("dashboard:chart Node health")}
            variant="borderless"
            style={{...cardStyle, height: "100%"}}
            styles={{body: {display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px"}}}
          >
            <div style={{display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40}}>
              <Progress
                type="circle"
                percent={nodeReadyRate}
                size={130}
                strokeColor={{"0%": "#0958d9", "100%": "#1677ff"}}
                format={(pct) => (
                  <span>
                    <div style={{fontSize: 22, fontWeight: "bold", color: "#1677ff", lineHeight: 1.2}}>{pct}%</div>
                    <div style={{fontSize: 11, color: "#999", marginTop: 4}}>{t("dashboard:label Online")}</div>
                  </span>
                )}
              />
              <div style={{display: "flex", flexDirection: "column", gap: 16, fontSize: 14}}>
                <div>
                  <div style={{color: "#1677ff", fontWeight: 600, fontSize: 22}}>{stats.nodesReady}</div>
                  <div style={{color: "#888"}}>{t("dashboard:label Online")}</div>
                </div>
                <div>
                  <div style={{color: "#6366f1", fontWeight: 600, fontSize: 22}}>{stats.nodesTotal - stats.nodesReady}</div>
                  <div style={{color: "#888"}}>{t("dashboard:label Offline")}</div>
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={7}>
          <Card
            title={t("dashboard:chart Pod availability")}
            variant="borderless"
            style={{...cardStyle, height: "100%"}}
            styles={{body: {display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px"}}}
          >
            <div style={{display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40}}>
              <Progress
                type="circle"
                percent={podRunningRate}
                size={130}
                strokeColor={{"0%": "#0ea5e9", "100%": "#0958d9"}}
                format={(pct) => (
                  <span>
                    <div style={{fontSize: 22, fontWeight: "bold", color: "#0958d9", lineHeight: 1.2}}>{pct}%</div>
                    <div style={{fontSize: 11, color: "#999", marginTop: 4}}>{t("dashboard:label Running")}</div>
                  </span>
                )}
              />
              <div style={{display: "flex", flexDirection: "column", gap: 16, fontSize: 14}}>
                <div>
                  <div style={{color: "#0958d9", fontWeight: 600, fontSize: 22}}>{stats.podsRunning}</div>
                  <div style={{color: "#888"}}>{t("dashboard:label Running")}</div>
                </div>
                <div>
                  <div style={{color: "#6366f1", fontWeight: 600, fontSize: 22}}>{stats.podsTotal - stats.podsRunning}</div>
                  <div style={{color: "#888"}}>{t("dashboard:label Other")}</div>
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title={t("dashboard:chart Service types")}
            variant="borderless"
            style={{...cardStyle, height: "100%"}}
          >
            <EchartsWidget option={svcTypeOption} style={{height: 200}} />
          </Card>
        </Col>
      </Row>

      {/* Row 4 — Node infrastructure (OS + Arch dual pie) */}
      <Row gutter={gutter} style={{marginTop: 16}}>
        <Col xs={24}>
          <Card
            title={t("dashboard:chart Node infra")}
            variant="borderless"
            style={cardStyle}
          >
            <EchartsWidget option={nodeInfraOption} style={{height: 220}} />
          </Card>
        </Col>
      </Row>

    </div>
  );
}

export default DashboardPage;
