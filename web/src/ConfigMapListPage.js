import React from "react";
import {
  Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography,
} from "antd";
import {DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as ConfigMapBackend from "./backend/ConfigMapBackend";
import * as Setting from "./Setting";

const {Title} = Typography;

class ConfigMapListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      configmaps: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add", // "add" | "edit"
      submitting: false,
      editingCm: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchConfigMaps();
  }

  fetchConfigMaps() {
    this.setState({loading: true, error: null});
    ConfigMapBackend.getConfigMaps().then(res => {
      if (res.status === "ok") {
        this.setState({configmaps: res.data ?? []});
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
    this.setState({modalVisible: true, modalMode: "add", editingCm: null}, () => {
      this.formRef.current?.setFieldsValue({name: "", namespace: "default", dataEntries: []});
    });
  }

  openEditModal(cm) {
    const dataEntries = Object.entries(cm.data ?? {}).map(([key, value]) => ({key, value}));
    this.setState({modalVisible: true, modalMode: "edit", editingCm: cm}, () => {
      this.formRef.current?.setFieldsValue({
        name: cm.name,
        namespace: cm.namespace,
        dataEntries,
      });
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingCm: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const data = {};
      (values.dataEntries ?? []).forEach(({key, value}) => {
        if (key) {
          data[key] = value ?? "";
        }
      });
      const payload = {
        name: values.name,
        namespace: values.namespace,
        data,
      };

      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        ConfigMapBackend.addConfigMap(payload).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "ConfigMap created");
            this.closeModal();
            this.fetchConfigMaps();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        const cm = this.state.editingCm;
        ConfigMapBackend.updateConfigMap({
          ...payload,
          resourceVersion: cm.resourceVersion,
        }).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "ConfigMap updated");
            this.closeModal();
            this.fetchConfigMaps();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(cm) {
    ConfigMapBackend.deleteConfigMap(cm.namespace, cm.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "ConfigMap deleted");
        this.fetchConfigMaps();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {configmaps, loading, error, modalVisible, modalMode, submitting} = this.state;

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 160},
      {title: "Name", dataIndex: "name", key: "name"},
      {
        title: "Data Keys",
        dataIndex: "dataKeys",
        key: "dataKeys",
        width: 110,
        render: v => v ?? 0,
      },
      {
        title: "Created",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 180,
      },
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_, record) => (
          <Space>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => this.openEditModal(record)}
            >
              Edit
            </Button>
            <Popconfirm
              title={`Delete ConfigMap "${record.name}"?`}
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
      <div>
        <Space style={{marginBottom: 16}}>
          <Title level={4} style={{margin: 0}}>ConfigMaps</Title>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => this.fetchConfigMaps()}
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
            message="Failed to fetch ConfigMaps"
            description={error}
            style={{marginBottom: 16}}
            showIcon
          />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={configmaps}
          loading={loading}
          size="middle"
          pagination={{pageSize: 20}}
          locale={{emptyText: "No ConfigMaps found"}}
        />

        <Modal
          title={modalMode === "add" ? "Add ConfigMap" : "Edit ConfigMap"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={600}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item
              label="Name"
              name="name"
              rules={[{required: true, message: "Name is required"}]}
            >
              <Input disabled={modalMode === "edit"} placeholder="my-configmap" />
            </Form.Item>
            <Form.Item
              label="Namespace"
              name="namespace"
              rules={[{required: true, message: "Namespace is required"}]}
            >
              <Input disabled={modalMode === "edit"} placeholder="default" />
            </Form.Item>

            <Form.List name="dataEntries">
              {(fields, {add, remove}) => (
                <>
                  <div style={{marginBottom: 8, fontWeight: 500}}>Data (key-value pairs)</div>
                  {fields.map(({key, name, ...rest}) => (
                    <Space key={key} align="baseline" style={{display: "flex", marginBottom: 4}}>
                      <Form.Item
                        {...rest}
                        name={[name, "key"]}
                        rules={[{required: true, message: "Key required"}]}
                        style={{marginBottom: 0}}
                      >
                        <Input placeholder="key" style={{width: 180}} />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "value"]}
                        style={{marginBottom: 0}}
                      >
                        <Input placeholder="value" style={{width: 240}} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{color: "#ff4d4f", cursor: "pointer"}} />
                    </Space>
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
      </div>
    );
  }
}

export default ConfigMapListPage;
