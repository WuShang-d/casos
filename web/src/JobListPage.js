import React from "react";
import {
  Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag
} from "antd";
import {DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as JobBackend from "./backend/JobBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";

class JobListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      jobs: [],
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add",
      submitting: false,
      editingJob: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchJobs();
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        this.setState({namespaces: res.data ?? []});
      }
    }).catch(() => {});
  }

  fetchJobs() {
    this.setState({loading: true, error: null});
    JobBackend.getJobs().then(res => {
      if (res.status === "ok") {
        this.setState({jobs: res.data ?? []});
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
    this.setState({modalVisible: true, modalMode: "add", editingJob: null}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: defaultNs,
          name: "",
          image: "",
          command: "",
          containerName: "",
          completions: 1,
          parallelism: 1,
          backoffLimit: 6,
        });
      }, 0);
    });
  }

  openEditModal(job) {
    this.setState({modalVisible: true, modalMode: "edit", editingJob: job}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          namespace: job.namespace,
          name: job.name,
          image: job.image,
          command: Array.isArray(job.command) ? job.command.join(" ") : (job.command ?? ""),
          completions: job.completions,
          parallelism: job.parallelism,
          backoffLimit: job.backoffLimit,
        });
      }, 0);
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingJob: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const command = (values.command ?? "").trim();
      const payload = {
        namespace: values.namespace,
        name: values.name,
        image: values.image,
        containerName: values.containerName ?? "",
        command: command ? command.split(/\s+/) : [],
        completions: values.completions ?? 1,
        parallelism: values.parallelism ?? 1,
        backoffLimit: values.backoffLimit ?? 6,
      };

      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        JobBackend.addJob(payload)
          .then(res => {
            if (res.status === "ok") {
              Setting.showMessage("success", "Job created");
              this.closeModal();
              this.fetchJobs();
            } else {
              Setting.showMessage("error", res.msg);
            }
          })
          .catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        JobBackend.updateJob({...payload, resourceVersion: this.state.editingJob.resourceVersion})
          .then(res => {
            if (res.status === "ok") {
              Setting.showMessage("success", "Job updated");
              this.closeModal();
              this.fetchJobs();
            } else {
              Setting.showMessage("error", res.msg);
            }
          })
          .catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(job) {
    JobBackend.deleteJob(job.namespace, job.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Job deleted");
        this.fetchJobs();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {jobs, namespaces, loading, error, modalVisible, modalMode, submitting} = this.state;

    const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 160},
      {title: "Name", dataIndex: "name", key: "name"},
      {title: "Image", dataIndex: "image", key: "image", ellipsis: true},
      {
        title: "Completions",
        key: "completions",
        width: 120,
        render: (_, r) => `${r.completions ?? 1}`,
      },
      {
        title: "Status",
        key: "status",
        width: 180,
        render: (_, r) => (
          <Space size={4}>
            {r.active > 0 && <Tag color="blue">Active: {r.active}</Tag>}
            {r.succeeded > 0 && <Tag color="green">Succeeded: {r.succeeded}</Tag>}
            {r.failed > 0 && <Tag color="red">Failed: {r.failed}</Tag>}
            {r.active === 0 && r.succeeded === 0 && r.failed === 0 && <Tag>Pending</Tag>}
          </Space>
        ),
      },
      {title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180},
      {
        title: "Actions",
        key: "actions",
        width: 160,
        render: (_, record) => (
          <Space size={4}>
            <Button size="small" icon={<EditOutlined />} onClick={() => this.openEditModal(record)}>Edit</Button>
            <Popconfirm
              title={`Delete Job "${record.name}"?`}
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
          <Alert type="error" message="Failed to fetch Jobs" description={error} style={{marginBottom: 16}} showIcon />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={jobs}
          loading={loading}
          size="middle"
          pagination={{pageSize: 20}}
          locale={{emptyText: "No Jobs found"}}
          title={() => (
            <div>
              <span style={{fontWeight: 600}}>Jobs</span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <Button icon={<ReloadOutlined />} onClick={() => this.fetchJobs()} loading={loading} size="small">Refresh</Button>
              &nbsp;&nbsp;
              <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => this.openAddModal()}>Add</Button>
            </div>
          )}
        />

        <Modal
          title={modalMode === "add" ? "Add Job" : "Edit Job"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={600}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item label="Namespace" name="namespace" rules={[{required: true, message: "Namespace is required"}]}>
              <Select
                disabled={modalMode === "edit"}
                options={nsOptions}
                placeholder="Select a namespace"
                showSearch
              />
            </Form.Item>
            <Form.Item label="Name" name="name" rules={[{required: true, message: "Name is required"}]}>
              <Input disabled={modalMode === "edit"} placeholder="my-job" />
            </Form.Item>
            <Form.Item label="Image" name="image" rules={[{required: true, message: "Image is required"}]}>
              <Input placeholder="busybox:latest" />
            </Form.Item>
            <Form.Item
              label="Command"
              name="command"
              tooltip="Space-separated command to run in the container. Leave empty to use the image default."
            >
              <Input placeholder='e.g. sh -c "echo hello"' />
            </Form.Item>
            {modalMode === "add" && (
              <Form.Item label="Container Name" name="containerName">
                <Input placeholder="Leave empty to use Job name" />
              </Form.Item>
            )}
            <Space size={16} style={{width: "100%"}} align="start">
              <Form.Item label="Completions" name="completions" rules={[{required: true}]} style={{flex: 1}}>
                <InputNumber min={1} style={{width: "100%"}} />
              </Form.Item>
              <Form.Item label="Parallelism" name="parallelism" rules={[{required: true}]} style={{flex: 1}}>
                <InputNumber min={1} style={{width: "100%"}} />
              </Form.Item>
              <Form.Item label="Backoff Limit" name="backoffLimit" rules={[{required: true}]} style={{flex: 1}}>
                <InputNumber min={0} style={{width: "100%"}} />
              </Form.Item>
            </Space>
          </Form>
        </Modal>
      </div>
    );
  }
}

export default JobListPage;
