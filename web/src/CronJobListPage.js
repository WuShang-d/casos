import React from "react";
import {
  Alert, Badge, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip
} from "antd";
import {DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined} from "@ant-design/icons";
import * as CronJobBackend from "./backend/CronJobBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";
import * as Setting from "./Setting";

const CONCURRENCY_POLICIES = ["Allow", "Forbid", "Replace"];

class CronJobListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      cronjobs: [],
      namespaces: [],
      loading: true,
      error: null,
      modalVisible: false,
      modalMode: "add",
      submitting: false,
      editingCj: null,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.fetchCronJobs();
    this.fetchNamespaces();
  }

  fetchNamespaces() {
    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        this.setState({namespaces: res.data ?? []});
      }
    }).catch(() => {});
  }

  fetchCronJobs() {
    this.setState({loading: true, error: null});
    CronJobBackend.getCronJobs().then(res => {
      if (res.status === "ok") {
        this.setState({cronjobs: res.data ?? []});
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
    this.setState({modalVisible: true, modalMode: "add", editingCj: null}, () => {
      setTimeout(() => {
        this.formRef.current?.setFieldsValue({
          name: "",
          namespace: defaultNs,
          schedule: "0 * * * *",
          image: "",
          command: "",
          concurrencyPolicy: "Allow",
          suspend: false,
          successfulJobsHistLimit: 3,
          failedJobsHistLimit: 1,
        });
      }, 0);
    });
  }

  openEditModal(cj) {
    this.setState({modalVisible: true, modalMode: "edit", editingCj: cj}, () => {
      setTimeout(() => {
        const cmd = Array.isArray(cj.command)
          ? cj.command.join(" ")
          : (cj.command || "").replace(/^\[|\]$/g, "").replace(/,/g, " ");
        this.formRef.current?.setFieldsValue({
          name: cj.name,
          namespace: cj.namespace,
          schedule: cj.schedule,
          image: cj.image,
          command: cmd,
          concurrencyPolicy: cj.concurrencyPolicy || "Allow",
          suspend: cj.suspend || false,
          successfulJobsHistLimit: cj.successfulJobsHistLimit ?? 3,
          failedJobsHistLimit: cj.failedJobsHistLimit ?? 1,
        });
      }, 0);
    });
  }

  closeModal() {
    this.setState({modalVisible: false, editingCj: null});
  }

  handleSubmit() {
    this.formRef.current?.validateFields().then(values => {
      const command = values.command
        ? values.command.trim().split(/\s+/).filter(Boolean)
        : [];
      const payload = {
        name: values.name,
        namespace: values.namespace,
        schedule: values.schedule,
        image: values.image,
        command,
        concurrencyPolicy: values.concurrencyPolicy,
        suspend: values.suspend || false,
        successfulJobsHistLimit: values.successfulJobsHistLimit ?? 3,
        failedJobsHistLimit: values.failedJobsHistLimit ?? 1,
      };

      this.setState({submitting: true});

      if (this.state.modalMode === "add") {
        CronJobBackend.addCronJob(payload).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Cron Job created");
            this.closeModal();
            this.fetchCronJobs();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      } else {
        const cj = this.state.editingCj;
        CronJobBackend.updateCronJob({...payload, resourceVersion: cj.resourceVersion}).then(res => {
          if (res.status === "ok") {
            Setting.showMessage("success", "Cron Job updated");
            this.closeModal();
            this.fetchCronJobs();
          } else {
            Setting.showMessage("error", res.msg);
          }
        }).catch(e => Setting.showMessage("error", e.message))
          .finally(() => this.setState({submitting: false}));
      }
    });
  }

  handleDelete(cj) {
    CronJobBackend.deleteCronJob(cj.namespace, cj.name).then(res => {
      if (res.status === "ok") {
        Setting.showMessage("success", "Cron Job deleted");
        this.fetchCronJobs();
      } else {
        Setting.showMessage("error", res.msg);
      }
    }).catch(e => Setting.showMessage("error", e.message));
  }

  render() {
    const {cronjobs, namespaces, loading, error, modalVisible, modalMode, submitting} = this.state;

    const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));

    const columns = [
      {title: "Namespace", dataIndex: "namespace", key: "namespace", width: 150},
      {title: "Name", dataIndex: "name", key: "name"},
      {title: "Schedule", dataIndex: "schedule", key: "schedule", width: 160, render: v => <code>{v}</code>},
      {title: "Image", dataIndex: "image", key: "image", ellipsis: true},
      {
        title: "Concurrency",
        dataIndex: "concurrencyPolicy",
        key: "concurrencyPolicy",
        width: 110,
        render: v => <Tag>{v || "Allow"}</Tag>,
      },
      {
        title: "Suspended",
        dataIndex: "suspend",
        key: "suspend",
        width: 100,
        render: v => v
          ? <Badge status="warning" text="Yes" />
          : <Badge status="success" text="No" />,
      },
      {title: "Last Schedule", dataIndex: "lastScheduleTime", key: "lastScheduleTime", width: 180},
      {title: "Created", dataIndex: "createdAt", key: "createdAt", width: 180},
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_, record) => (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => this.openEditModal(record)}>Edit</Button>
            <Popconfirm
              title={`Delete Cron Job "${record.name}"?`}
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
            message="Failed to fetch Cron Jobs"
            description={error}
            style={{marginBottom: 16}}
            showIcon
          />
        )}

        <Table
          rowKey={r => `${r.namespace}/${r.name}`}
          columns={columns}
          dataSource={cronjobs}
          loading={loading}
          size="middle"
          scroll={{x: 1200}}
          pagination={{pageSize: 20}}
          locale={{emptyText: "No Cron Jobs found"}}
          title={() => (
            <div>
              <span style={{fontWeight: 600}}>Cron Jobs</span>
              &nbsp;&nbsp;&nbsp;&nbsp;
              <Button icon={<ReloadOutlined />} onClick={() => this.fetchCronJobs()} loading={loading} size="small">
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
          title={modalMode === "add" ? "Add Cron Job" : "Edit Cron Job"}
          open={modalVisible}
          onOk={() => this.handleSubmit()}
          onCancel={() => this.closeModal()}
          confirmLoading={submitting}
          okText={modalMode === "add" ? "Create" : "Update"}
          width={580}
          destroyOnHidden
        >
          <Form ref={this.formRef} layout="vertical">
            <Form.Item label="Namespace" name="namespace" rules={[{required: true, message: "Namespace is required"}]}>
              <Select disabled={modalMode === "edit"} options={nsOptions} placeholder="Select a namespace" showSearch />
            </Form.Item>
            <Form.Item label="Name" name="name" rules={[{required: true, message: "Name is required"}]}>
              <Input disabled={modalMode === "edit"} placeholder="my-cronjob" />
            </Form.Item>
            <Form.Item
              label={
                <Tooltip title="Cron expression, e.g. '0 * * * *' runs every hour">Schedule</Tooltip>
              }
              name="schedule"
              rules={[{required: true, message: "Schedule is required"}]}
            >
              <Input placeholder="0 * * * *" />
            </Form.Item>
            <Form.Item label="Image" name="image" rules={[{required: true, message: "Image is required"}]}>
              <Input placeholder="busybox:latest" />
            </Form.Item>
            <Form.Item label="Command (space-separated)" name="command">
              <Input placeholder='echo "hello world"' />
            </Form.Item>
            <Form.Item label="Concurrency Policy" name="concurrencyPolicy">
              <Select options={CONCURRENCY_POLICIES.map(p => ({label: p, value: p}))} />
            </Form.Item>
            <Space size="large" style={{width: "100%"}}>
              <Form.Item label="Suspended" name="suspend" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item label="Successful Jobs History Limit" name="successfulJobsHistLimit">
                <InputNumber min={0} style={{width: 80}} />
              </Form.Item>
              <Form.Item label="Failed Jobs History Limit" name="failedJobsHistLimit">
                <InputNumber min={0} style={{width: 80}} />
              </Form.Item>
            </Space>
          </Form>
        </Modal>
      </div>
    );
  }
}

export default CronJobListPage;
