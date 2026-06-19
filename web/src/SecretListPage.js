import React from "react";
import {
  Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag
} from "antd";
import {DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as SecretBackend from "./backend/SecretBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";
import RestartDeploymentsModal from "./RestartDeploymentsModal";

const SECRET_TYPES = [
  {label: "Opaque", value: "Opaque"},
  {label: "kubernetes.io/tls", value: "kubernetes.io/tls"},
  {label: "kubernetes.io/dockerconfigjson", value: "kubernetes.io/dockerconfigjson"},
  {label: "kubernetes.io/basic-auth", value: "kubernetes.io/basic-auth"},
  {label: "kubernetes.io/ssh-auth", value: "kubernetes.io/ssh-auth"},
  {label: "kubernetes.io/service-account-token", value: "kubernetes.io/service-account-token"},
];

class SecretListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      secrets: [],
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add",
      submitting: false,
      editingSecret: null,
      restartTarget: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchSecrets();
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {this.setState({namespaces: res.data ?? []});}
    }).catch(() => {});
  }

  fetchSecrets() {
    this.setState({loading: true, error: null});
    SecretBackend.getSecrets().then(res => {
      if (res.status === "ok") {
        this.setState({secrets: res.data ?? []});
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
    this.setState({modalVisible: true, modalMode: "add", editingSecret: null}, () => {
      const defaultNs = this.state.namespaces.length > 0 ? this.state.namespaces[0].name : "default";
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({name: "", namespace: defaultNs, type: "Opaque", dataEntries: []});
      }, 0);
    });
  }

  openEditModal(secret) {
    const dataEntries = Object.entries(secret.stringData ?? {}).map(([key, value]) => ({key, value}));
    this.setState({modalVisible: true, modalMode: "edit", editingSecret: secret}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          name: secret.name, namespace: secret.namespace,
          type: secret.type || "Opaque", dataEntries,
        });
      }, 0);
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingSecret: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const stringData = {};
      (values.dataEntries ?? []).forEach(({key, value}) => {
        if (key) {stringData[key] = value ?? "";}
      });
      const payload = {name: values.name, namespace: values.namespace, type: values.type, stringData};

      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        SecretBackend.addSecret(payload).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Secret created");
            this.closeModal();
            this.fetchSecrets();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        const s = this.state.editingSecret;
        SecretBackend.updateSecret({...payload, resourceVersion: s.resourceVersion}).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Secret updated");
            this.closeModal();
            this.fetchSecrets();
            this.setState({restartTarget: {namespace: s.namespace, name: s.name}});
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(secret) {
    SecretBackend.deleteSecret(secret.namespace, secret.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Secret deleted");
        this.fetchSecrets();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {secrets, namespaces, loading, error, modalVisible, modalMode, submitting, restartTarget} = this.state;

    const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 160},
      {title: "Name", dataIndex: "name", key: "name", width: 200},
      {title: "Type", dataIndex: "type", key: "type", width: 200},
      {
        title: "Keys",
        dataIndex: "stringData",
        key: "keys",
        render: data => (
          <Space size={4} wrap>
            {Object.keys(data ?? {}).map(k => (
              <Tag key={k} color="orange" style={{fontFamily: "monospace", fontSize: 11}}>{k}</Tag>
            ))}
          </Space>
        ),
      },
      {title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180},
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_, record) => (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => this.openEditModal(record)}>Edit</Button>
            <Popconfirm
              title={`Delete Secret "${record.name}"?`}
              okText="Delete" okType="danger" cancelText="Cancel"
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
          <Alert type="error" message="Failed to fetch Secrets" description={error} style={{marginBottom: 16}} showIcon />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={secrets}
          loading={loading}
          size="middle"
          pagination={{pageSize: 20}}
          locale={{emptyText: "No Secrets found"}}
          title={() => (
            <div>
              <span style={{fontWeight: 600}}>Secrets</span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <Button icon={<ReloadOutlined />} onClick={() => this.fetchSecrets()} loading={loading} size="small">Refresh</Button>
              &nbsp;&nbsp;
              <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => this.openAddModal()}>Add</Button>
            </div>
          )}
        />

        <Modal
          title={modalMode === "add" ? "Add Secret" : "Edit Secret"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={680}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item label="Namespace" name="namespace" rules={[{required: true, message: "Namespace is required"}]}>
              <Select disabled={modalMode === "edit"} options={nsOptions} placeholder="Select a namespace" showSearch />
            </Form.Item>
            <Form.Item label="Name" name="name" rules={[{required: true, message: "Name is required"}]}>
              <Input disabled={modalMode === "edit"} placeholder="my-secret" />
            </Form.Item>
            <Form.Item label="Type" name="type" rules={[{required: true, message: "Type is required"}]}>
              <Select disabled={modalMode === "edit"} options={SECRET_TYPES} placeholder="Select secret type" />
            </Form.Item>

            <Form.List name="dataEntries">
              {(fields, {add, remove}) => (
                <>
                  <div style={{marginBottom: 8, fontWeight: 500}}>Data (key-value pairs)</div>
                  {fields.map(({key, name, ...rest}) => (
                    <div key={key} style={{display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start"}}>
                      <Form.Item
                        {...rest}
                        name={[name, "key"]}
                        rules={[{required: true, message: "Key required"}]}
                        style={{marginBottom: 0, flex: "0 0 160px"}}
                      >
                        <Input placeholder="key" />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "value"]}
                        style={{marginBottom: 0, flex: 1}}
                      >
                        <Input.Password
                          placeholder="value"
                          style={{fontFamily: "monospace", fontSize: 12}}
                        />
                      </Form.Item>
                      <MinusCircleOutlined
                        onClick={() => remove(name)}
                        style={{color: "#ff4d4f", cursor: "pointer", marginTop: 8}}
                      />
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add()}
                    icon={<PlusOutlined />}
                    style={{marginTop: 4}}
                    size="small"
                  >
                    Add Entry
                  </Button>
                </>
              )}
            </Form.List>
          </Form>
        </Modal>

        <RestartDeploymentsModal
          open={restartTarget !== null}
          onClose={() => this.setState({restartTarget: null})}
          namespace={restartTarget?.namespace ?? ""}
          configType="secret"
          configName={restartTarget?.name ?? ""}
        />
      </div>
    );
  }
}

export default SecretListPage;
