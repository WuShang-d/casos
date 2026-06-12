import React, { useEffect, useState } from "react";
import { Table, Typography, Spin, Alert, Tag, Button, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import axios from "axios";

const { Title } = Typography;

const phaseColor = {
  Running:   "green",
  Pending:   "gold",
  Succeeded: "blue",
  Failed:    "red",
  Unknown:   "default",
};

const columns = [
  {
    title: "Namespace",
    dataIndex: "namespace",
    key: "namespace",
    width: 180,
  },
  {
    title: "Name",
    dataIndex: "name",
    key: "name",
  },
  {
    title: "Node",
    dataIndex: "nodeName",
    key: "nodeName",
    width: 200,
    render: (v) => v || <span style={{ color: "#999" }}>—</span>,
  },
  {
    title: "Phase",
    dataIndex: "phase",
    key: "phase",
    width: 120,
    render: (phase) => (
      <Tag color={phaseColor[phase] ?? "default"}>{phase || "Unknown"}</Tag>
    ),
  },
];

export default function PodList() {
  const [pods, setPods]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchPods = () => {
    setLoading(true);
    setError(null);
    axios
      .get("/api/pods")
      .then((res) => setPods(res.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPods(); }, []);

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Pods</Title>
        <Button
          icon={<ReloadOutlined />}
          onClick={fetchPods}
          loading={loading}
          size="small"
        >
          Refresh
        </Button>
      </Space>

      {error && (
        <Alert
          type="error"
          message="Failed to fetch pods"
          description={error}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Table
        rowKey={(r) => `${r.namespace}/${r.name}`}
        columns={columns}
        dataSource={pods}
        loading={loading}
        size="middle"
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: "No pods found" }}
      />
    </div>
  );
}
