import React from "react";
import {
  Alert, Badge, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table
} from "antd";
import {DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ShareAltOutlined} from "@ant-design/icons";
import * as DeploymentBackend from "./backend/DeploymentBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";
import DeploymentExposeModal from "./DeploymentExposeModal";

class DeploymentListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      deployments: [],
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add",
      submitting: false,
      editingDeploy: null,
      exposeDeploy: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchDeployments();
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        this.setState({namespaces: res.data ?? []});
      }
    }).catch(() => {});
  }

  fetchDeployments() {
    this.setState({loading: true, error: null});
    DeploymentBackend.getDeployments().then(res => {
      if (res.status === "ok") {
        this.setState({deployments: res.data ?? []});
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
    this.setState({modalVisible: true, modalMode: "add", editingDeploy: null}, () => {
      const defaultNs = this.state.namespaces.length > 0 ? this.state.namespaces[0].name : "default";
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: defaultNs,
          name: "",
          replicas: 1,
          image: "",
          containerName: "",
        });
      }, 0);
    });
  }

  openEditModal(deploy) {
    this.setState({modalVisible: true, modalMode: "edit", editingDeploy: deploy}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: deploy.namespace,
          name: deploy.name,
          replicas: deploy.replicas,
          image: deploy.image,
          containerName: "",
        });
      }, 0);
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingDeploy: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const payload = {
        namespace: values.namespace,
        name: values.name,
        replicas: values.replicas ?? 1,
        image: values.image,
        containerName: values.containerName ?? "",
      };

      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        DeploymentBackend.addDeployment(payload).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Deployment created");
            this.closeModal();
            this.fetchDeployments();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        const deploy = this.state.editingDeploy;
        DeploymentBackend.updateDeployment({
          ...payload,
          resourceVersion: deploy.resourceVersion,
        }).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Deployment updated");
            this.closeModal();
            this.fetchDeployments();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(deploy) {
    DeploymentBackend.deleteDeployment(deploy.namespace, deploy.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Deployment deleted");
        this.fetchDeployments();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {deployments, namespaces, loading, error, modalVisible, modalMode, submitting, exposeDeploy} = this.state;

    const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 160},
      {title: "Name", dataIndex: "name", key: "name"},
      {title: "Image", dataIndex: "image", key: "image", ellipsis: true},
      {
        title: "Replicas",
        key: "replicas",
        width: 120,
        render: (_, r) => `${r.readyReplicas ?? 0} / ${r.replicas ?? 0}`,
      },
      {
        title: "Available",
        dataIndex: "availableReplicas",
        key: "availableReplicas",
        width: 100,
        render: (v, r) => (
          <Badge
            status={v >= (r.replicas ?? 0) && (r.replicas ?? 0) > 0 ? "success" : "warning"}
            text={v ?? 0}
          />
        ),
      },
      {title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180},
      {
        title: "Actions",
        key: "actions",
        width: 210,
        render: (_, record) => (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => this.openEditModal(record)}
            >
              Edit
            </Button>
            <Button
              size="small"
              icon={<ShareAltOutlined />}
              onClick={() => this.setState({exposeDeploy: record})}
            >
              Expose
            </Button>
            <Popconfirm
              title={`Delete Deployment "${record.name}"?`}
              okText="Delete"
              okType="danger"
              cancelText="Cancel"
              onConfirm={() => this.handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ];

    return (
      <div style={{padding: "24px"}}>
        {error && (
          <Alert
            type="error"
            message="Failed to fetch Deployments"
            description={error}
            style={{marginBottom: 16}}
            showIcon
          />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={deployments}
          loading={loading}
          size="middle"
          pagination={{pageSize: 20}}
          locale={{emptyText: "No Deployments found"}}
          title={() => (
            <div>
              <span style={{fontWeight: 600}}>Deployments</span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <Button icon={<ReloadOutlined />} onClick={() => this.fetchDeployments()} loading={loading} size="small">
                Refresh
              </Button>
              &nbsp;&nbsp;
              <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => this.openAddModal()}>
                Add
              </Button>
            </div>
          )}
        />

        <DeploymentExposeModal
          deploy={exposeDeploy}
          open={exposeDeploy !== null}
          onClose={() => this.setState({exposeDeploy: null})}
        />

        <Modal
          title={modalMode === "add" ? "Add Deployment" : "Edit Deployment"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={560}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item
              label="Namespace"
              name="namespace"
              rules={[{required: true, message: "Namespace is required"}]}
            >
              <Select
                disabled={modalMode === "edit"}
                options={nsOptions}
                placeholder="Select a namespace"
                showSearch
              />
            </Form.Item>
            <Form.Item
              label="Name"
              name="name"
              rules={[{required: true, message: "Name is required"}]}
            >
              <Input disabled={modalMode === "edit"} placeholder="my-deployment" />
            </Form.Item>
            <Form.Item
              label="Image"
              name="image"
              rules={[{required: true, message: "Image is required"}]}
            >
              <Input placeholder="nginx:latest" />
            </Form.Item>
            <Form.Item label="Replicas" name="replicas" rules={[{required: true}]}>
              <InputNumber min={0} style={{width: "100%"}} />
            </Form.Item>
            {modalMode === "add" && (
              <Form.Item label="Container Name" name="containerName">
                <Input placeholder="Leave empty to use deployment name" />
              </Form.Item>
            )}
          </Form>
        </Modal>
      </div>
    );
  }
}

export default DeploymentListPage;
