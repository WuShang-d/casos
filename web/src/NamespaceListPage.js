import React from "react";
import {Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography} from "antd";
import {DeleteOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";

const {Title} = Typography;

const statusColor = {
  Active: "green",
  Terminating: "red",
};

class NamespaceListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      submitting: false,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    this.setState({loading: true, error: null});
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        this.setState({namespaces: res.data ?? []});
      } else {
        Setting.showMessage("error", res.msg);
        this.setState({error: res.msg});
      }
    }).catch(e => {
      Setting.showMessage("error", e.message);
      this.setState({error: e.message});
    }).finally(() => {
      this.setState({loading: false});
    });
  }

  openAddModal() {
    this.setState({modalVisible: true}, () => {
      this.formRef.current?.setFieldsValue({name: ""});
    });
  }

  closeModal() {
    this.setState({modalVisible: false});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      this.setState({submitting: true});
      NamespaceBackend.addNamespace({name: values.name}).then(res => {
        if (res.status === "ok") {
          Setting.showMessage("success", "Namespace created");
          this.closeModal();
          this.fetchNamespaces();
        } else {
          Setting.showMessage("error", res.msg);
        }
      }).catch(e => Setting.showMessage("error", e.message))
        .finally(() => this.setState({submitting: false}));
    });
  }

  handleDelete(name) {
    NamespaceBackend.deleteNamespace(name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Namespace deleted");
        this.fetchNamespaces();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {namespaces, loading, error, modalVisible, submitting} = this.state;

    const columns = [
      {title: "Name", dataIndex: "name", key: "name"},
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 130,
        render: v => <Tag color={statusColor[v] ?? "default"}>{v || "Unknown"}</Tag>,
      },
      {title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180},
      {
        title: "Actions",
        key: "actions",
        width: 100,
        render: (_, record) => (
          <Popconfirm
            title={`Delete namespace "${record.name}"?`}
            description="All resources in this namespace will be deleted."
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
            onConfirm={() => this.handleDelete(record.name)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
          </Popconfirm>
        ),
      },
    ];

    return (
      <div>
        <Space style={{marginBottom: 16}}>
          <Title level={4} style={{margin: 0}}>Namespaces</Title>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => this.fetchNamespaces()}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => this.openAddModal()}
          >
            Add
          </Button>
        </Space>

        {error && (
          <Alert
            type="error"
            message="Failed to fetch namespaces"
            description={error}
            style={{marginBottom: 16}}
            showIcon
          />
        )}

        <Table
          rowKey="name"
          columns={columns}
          dataSource={namespaces}
          loading={loading}
          size="middle"
          pagination={{pageSize: 20}}
          locale={{emptyText: "No namespaces found"}}
        />

        <Modal
          title="Add Namespace"
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText="Create"
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item
              label="Name"
              name="name"
              rules={[
                {required: true, message: "Name is required"},
                {pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, message: "Must be lowercase alphanumeric with hyphens"},
              ]}
            >
              <Input placeholder="my-namespace" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }
}

export default NamespaceListPage;
