import React from "react";
import {
  Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag
} from "antd";
import {DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as RoleBindingBackend from "./backend/RoleBindingBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";

const SUBJECT_KINDS = ["ServiceAccount", "User", "Group"];

const kindColor = {
  ServiceAccount: "blue",
  User: "green",
  Group: "purple",
};

function subjectsToFormRows(subjects) {
  return (subjects ?? []).map(s => ({
    kind: s.kind,
    name: s.name,
    namespace: s.namespace || "",
  }));
}

class RoleBindingListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      rolebindings: [],
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add",
      submitting: false,
      editingRb: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchRoleBindings();
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        this.setState({namespaces: res.data ?? []});
      }
    }).catch(() => {});
  }

  fetchRoleBindings() {
    this.setState({loading: true, error: null});
    RoleBindingBackend.getRoleBindings().then(res => {
      if (res.status === "ok") {
        this.setState({rolebindings: res.data ?? []});
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
    const defaultNs = this.state.namespaces.length > 0 ? this.state.namespaces[0].name : "default";
    this.setState({modalVisible: true, modalMode: "add", editingRb: null}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: defaultNs,
          name: "",
          roleRef: "",
          roleRefKind: "Role",
          subjects: [],
        });
      }, 0);
    });
  }

  openEditModal(rb) {
    this.setState({modalVisible: true, modalMode: "edit", editingRb: rb}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: rb.namespace,
          name: rb.name,
          roleRef: rb.roleRef,
          roleRefKind: rb.roleRefKind || "Role",
          subjects: subjectsToFormRows(rb.subjects),
        });
      }, 0);
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingRb: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const subjects = (values.subjects ?? []).filter(s => s && s.name);
      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        RoleBindingBackend.addRoleBinding({
          namespace: values.namespace,
          name: values.name,
          roleRef: values.roleRef,
          roleRefKind: values.roleRefKind || "Role",
          subjects,
        }).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Role Binding created");
            this.closeModal();
            this.fetchRoleBindings();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        const rb = this.state.editingRb;
        RoleBindingBackend.updateRoleBinding({
          namespace: rb.namespace,
          name: rb.name,
          roleRef: rb.roleRef,
          subjects,
          resourceVersion: rb.resourceVersion,
        }).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Role Binding updated");
            this.closeModal();
            this.fetchRoleBindings();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(rb) {
    RoleBindingBackend.deleteRoleBinding(rb.namespace, rb.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Role Binding deleted");
        this.fetchRoleBindings();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {rolebindings, namespaces, loading, error, modalVisible, modalMode, submitting} = this.state;

    const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 150},
      {title: "Name", dataIndex: "name", key: "name"},
      {
        title: "Role Ref Kind",
        dataIndex: "roleRefKind",
        key: "roleRefKind",
        width: 130,
        render: v => <Tag color="geekblue">{v}</Tag>,
      },
      {
        title: "Role Ref",
        dataIndex: "roleRef",
        key: "roleRef",
        width: 200,
        render: v => <Tag color="volcano">{v}</Tag>,
      },
      {
        title: "Subjects",
        dataIndex: "subjects",
        key: "subjects",
        render: subjects => (subjects ?? []).map((s, i) => (
          <Tag key={i} color={kindColor[s.kind] ?? "default"}>
            {s.kind}/{s.name}{s.namespace ? ` (${s.namespace})` : ""}
          </Tag>
        )),
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
              title={`Delete Role Binding "${record.name}"?`}
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
          <Alert type="error" message="Failed to fetch Role Bindings" description={error} style={{marginBottom: 16}} showIcon />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={rolebindings}
          loading={loading}
          size="middle"
          scroll={{x: 1100}}
          pagination={{pageSize: 20}}
          locale={{emptyText: "No Role Bindings found"}}
          title={() => (
            <div>
              <span style={{fontWeight: 600}}>Role Bindings</span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <Button icon={<ReloadOutlined />} onClick={() => this.fetchRoleBindings()} loading={loading} size="small">
                Refresh
              </Button>
              &nbsp;&nbsp;
              <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => this.openAddModal()}>
                Add
              </Button>
            </div>
          )}
        />

        <Modal
          title={modalMode === "add" ? "Add Role Binding" : "Edit Role Binding"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={640}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item label="Namespace" name="namespace" rules={[{required: true, message: "Required"}]}>
              <Select disabled={modalMode === "edit"} options={nsOptions} placeholder="Select a namespace" showSearch />
            </Form.Item>

            <Form.Item label="Name" name="name" rules={[{required: true, message: "Required"}]}>
              <Input disabled={modalMode === "edit"} placeholder="my-role-binding" />
            </Form.Item>

            <Space.Compact style={{width: "100%", marginBottom: 0}}>
              <Form.Item
                label="Role Ref Kind"
                name="roleRefKind"
                style={{width: "40%", marginBottom: 24}}
              >
                <Select
                  disabled={modalMode === "edit"}
                  options={[
                    {label: "Role", value: "Role"},
                    {label: "Cluster Role", value: "ClusterRole"},
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="Role Ref Name"
                name="roleRef"
                style={{width: "60%", marginBottom: 24}}
                rules={[{required: true, message: "Required"}]}
              >
                <Input disabled={modalMode === "edit"} placeholder="my-role" />
              </Form.Item>
            </Space.Compact>

            {modalMode === "edit" && (
              <div style={{marginBottom: 8, color: "#888", fontSize: 12}}>
                Note: Role Ref is immutable after creation. Only subjects can be updated.
              </div>
            )}

            <Form.List name="subjects">
              {(fields, {add, remove}) => (
                <>
                  <div style={{marginBottom: 8, fontWeight: 500}}>Subjects</div>
                  {fields.map(({key, name, ...rest}) => (
                    <Space key={key} align="baseline" style={{display: "flex", marginBottom: 4, flexWrap: "wrap"}}>
                      <Form.Item
                        {...rest}
                        name={[name, "kind"]}
                        rules={[{required: true, message: "Kind required"}]}
                        style={{marginBottom: 0}}
                      >
                        <Select
                          options={SUBJECT_KINDS.map(k => ({label: k, value: k}))}
                          placeholder="Kind"
                          style={{width: 140}}
                        />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "name"]}
                        rules={[{required: true, message: "Name required"}]}
                        style={{marginBottom: 0}}
                      >
                        <Input placeholder="name" style={{width: 160}} />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "namespace"]}
                        style={{marginBottom: 0}}
                      >
                        <Input placeholder="namespace (SA only)" style={{width: 160}} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{color: "#ff4d4f", cursor: "pointer"}} />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({kind: "ServiceAccount", name: "", namespace: ""})}
                    icon={<PlusOutlined />}
                    size="small"
                    style={{marginTop: 4}}
                  >
                    Add Subject
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

export default RoleBindingListPage;
