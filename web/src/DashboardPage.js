import React, {useEffect, useMemo, useRef, useState} from "react";
import {Card, Col, Progress, Row, Spin, Statistic} from "antd";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  UserOutlined
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

  return (
    <div style={{padding: 24}}>

      {/* Row 1 — 8 stat cards */}
      <Row gutter={gutter}>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Total Nodes"
              value={stats.nodesTotal}
              prefix={<ClusterOutlined style={{color: "#1677ff"}} />}
              valueStyle={{color: "#1677ff"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Nodes Ready"
              value={stats.nodesReady}
              prefix={<CheckCircleOutlined style={{color: "#14b8a6"}} />}
              valueStyle={{color: "#14b8a6"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Total Pods"
              value={stats.podsTotal}
              prefix={<AppstoreOutlined style={{color: "#0958d9"}} />}
              valueStyle={{color: "#0958d9"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Running Pods"
              value={stats.podsRunning}
              prefix={<AppstoreOutlined style={{color: "#0ea5e9"}} />}
              valueStyle={{color: "#0ea5e9"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Namespaces"
              value={stats.namespacesTotal}
              prefix={<SettingOutlined style={{color: "#6366f1"}} />}
              valueStyle={{color: "#6366f1"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Services"
              value={stats.servicesTotal}
              prefix={<NodeIndexOutlined style={{color: "#8b5cf6"}} />}
              valueStyle={{color: "#8b5cf6"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="ConfigMaps"
              value={stats.configMapsTotal}
              prefix={<SettingOutlined style={{color: "#0891b2"}} />}
              valueStyle={{color: "#0891b2"}}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Card variant="borderless" style={cardStyle}>
            <Statistic
              title="Service Accounts"
              value={stats.serviceAccounts}
              prefix={<UserOutlined style={{color: "#5734d3"}} />}
              valueStyle={{color: "#5734d3"}}
            />
          </Card>
        </Col>
      </Row>

      {/* Row 2 — Pods by namespace (bar) + Pod phase (donut) */}
      <Row gutter={gutter} style={{marginTop: 16}}>
        <Col xs={24} xl={14}>
          <Card
            title="Pods by Namespace"
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
            title="Pod Phase Distribution"
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
            title="Node Health"
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
                    <div style={{fontSize: 11, color: "#999", marginTop: 4}}>Ready</div>
                  </span>
                )}
              />
              <div style={{display: "flex", flexDirection: "column", gap: 16, fontSize: 14}}>
                <div>
                  <div style={{color: "#1677ff", fontWeight: 600, fontSize: 22}}>{stats.nodesReady}</div>
                  <div style={{color: "#888"}}>Ready</div>
                </div>
                <div>
                  <div style={{color: "#6366f1", fontWeight: 600, fontSize: 22}}>{stats.nodesTotal - stats.nodesReady}</div>
                  <div style={{color: "#888"}}>Not Ready</div>
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={7}>
          <Card
            title="Pod Availability"
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
                    <div style={{fontSize: 11, color: "#999", marginTop: 4}}>Running</div>
                  </span>
                )}
              />
              <div style={{display: "flex", flexDirection: "column", gap: 16, fontSize: 14}}>
                <div>
                  <div style={{color: "#0958d9", fontWeight: 600, fontSize: 22}}>{stats.podsRunning}</div>
                  <div style={{color: "#888"}}>Running</div>
                </div>
                <div>
                  <div style={{color: "#6366f1", fontWeight: 600, fontSize: 22}}>{stats.podsTotal - stats.podsRunning}</div>
                  <div style={{color: "#888"}}>Other</div>
                </div>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title="Service Types"
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
            title="Node Infrastructure  (left: OS · right: Architecture)"
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
