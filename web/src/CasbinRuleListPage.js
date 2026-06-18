import React from "react";
import {Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography} from "antd";
import {DeleteOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined} from "@ant-design/icons";
import * as CasbinRuleBackend from "./backend/CasbinRuleBackend";
import * as Setting from "./Setting";

const {Text} = Typography;
const {Option} = Select;

const RESOURCES = ["*", "pods", "deployments", "statefulsets", "services", "ingresses",
  "configmaps", "secrets", "persistentvolumeclaims", "nodes", "namespaces",
  "serviceaccounts", "clusterrolebindings"];
const ACTIONS = ["*", "CREATE", "UPDATE", "DELETE", "CONNECT"];
const PTYPES = [
  {value: "p", label: "p — policy"},
  {value: "g", label: "g — role assignment"},
];

function ruleTag(pType) {
  return pType === "g"
    ? <Tag color="blue">role</Tag>
    : <Tag color="green">policy</Tag>;
}

class CasbinRuleListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      rules: [],
      loading: true,
      modalVisible: false,
      submitting: false,
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.loadRules();
  }

  loadRules() {
    this.setState({loading: true});
    CasbinRuleBackend.getCasbinRules()
      .then(res => {
        if (res.status === "ok") {
          this.setState({rules: res.data || [], loading: false});
        } else {
          Setting.showMessage("error", res.msg);
          this.setState({loading: false});
        }
      })
      .catch(err => {
        Setting.showMessage("error", err.message);
        this.setState({loading: false});
      });
  }

  handleAdd(values) {
    this.setState({submitting: true});
    const rule = {
      pType: values.pType,
      v0: values.v0,
      v1: values.v1 || "",
      v2: values.v2 || "",
      v3: values.v3 || "",
    };
    CasbinRuleBackend.addCasbinRule(rule)
      .then(res => {
        if (res.status === "ok") {
          Setting.showMessage("success", "Rule added");
          this.setState({modalVisible: false, submitting: false});
          this.formRef.current?.resetFields();
          this.loadRules();
        } else {
          Setting.showMessage("error", res.msg);
          this.setState({submitting: false});
        }
      })
      .catch(err => {
        Setting.showMessage("error", err.message);
        this.setState({submitting: false});
      });
  }

  handleDelete(id) {
    CasbinRuleBackend.deleteCasbinRule(id)
      .then(res => {
        if (res.status === "ok") {
          Setting.showMessage("success", "Rule deleted");
          this.loadRules();
        } else {
          Setting.showMessage("error", res.msg);
        }
      });
  }

  handleReload() {
    CasbinRuleBackend.reloadCasbinEnforcer()
      .then(res => {
        if (res.status === "ok") {
          Setting.showMessage("success", "Enforcer reloaded");
        } else {
          Setting.showMessage("error", res.msg);
        }
      });
  }

  renderAddModal() {
    const {modalVisible, submitting} = this.state;
    return (
      <Modal
        title="Add Casbin Rule"
        open={modalVisible}
        onCancel={() => {
          this.setState({modalVisible: false});
          this.formRef.current?.resetFields();
        }}
        onOk={() => this.formRef.current?.submit()}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form ref={this.formRef} layout="vertical" onFinish={(v) => this.handleAdd(v)} initialValues={{pType: "p", v1: "*", v2: "*", v3: "*"}}>
          <Form.Item name="pType" label="Type" rules={[{required: true}]}>
            <Select>
              {PTYPES.map(pt => <Option key={pt.value} value={pt.value}>{pt.label}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.pType !== cur.pType}>
            {({getFieldValue}) => {
              const isPolicy = getFieldValue("pType") === "p";
              return (
                <>
                  <Form.Item name="v0" label={isPolicy ? "Subject (user or role)" : "User / Group"} rules={[{required: true, message: "required"}]}>
                    <Input placeholder={isPolicy ? "e.g. alice or role:admin" : "e.g. alice"} />
                  </Form.Item>
                  {isPolicy ? (
                    <>
                      <Form.Item name="v1" label="Namespace">
                        <Input placeholder="* for all namespaces" />
                      </Form.Item>
                      <Form.Item name="v2" label="Resource">
                        <Select showSearch allowClear placeholder="* for all resources">
                          {RESOURCES.map(r => <Option key={r} value={r}>{r}</Option>)}
                        </Select>
                      </Form.Item>
                      <Form.Item name="v3" label="Action">
                        <Select placeholder="* for all actions">
                          {ACTIONS.map(a => <Option key={a} value={a}>{a}</Option>)}
                        </Select>
                      </Form.Item>
                    </>
                  ) : (
                    <Form.Item name="v1" label="Role" rules={[{required: true, message: "required"}]}>
                      <Input placeholder="e.g. role:admin" />
                    </Form.Item>
                  )}
                </>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    );
  }

  render() {
    const {rules, loading} = this.state;

    const columns = [
      {
        title: "Type",
        dataIndex: "pType",
        width: 90,
        render: (v) => ruleTag(v),
      },
      {
        title: "Subject / User",
        dataIndex: "v0",
        render: (v) => <Text code>{v}</Text>,
      },
      {
        title: "Namespace / Role",
        dataIndex: "v1",
        render: (v) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>,
      },
      {
        title: "Resource",
        dataIndex: "v2",
        render: (v) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>,
      },
      {
        title: "Action",
        dataIndex: "v3",
        render: (v) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>,
      },
      {
        title: "Action",
        key: "actions",
        width: 80,
        align: "center",
        render: (_, record) => (
          <Popconfirm title="Delete this rule?" onConfirm={() => this.handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        ),
      },
    ];

    return (
      <div style={{padding: "24px"}}>
        <div style={{display: "flex", alignItems: "center", marginBottom: 16, gap: 8}}>
          <SafetyCertificateOutlined style={{fontSize: 20, color: "#1677ff"}} />
          <span style={{fontSize: 16, fontWeight: 600}}>Casbin Admission Policy</span>
          <div style={{flex: 1}} />
          <Space>
            <Tooltip title="Reload enforcer from DB (auto-reloads on every change)">
              <Button icon={<ReloadOutlined />} onClick={() => this.handleReload()}>Reload Enforcer</Button>
            </Tooltip>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => this.setState({modalVisible: true})}>
              Add Rule
            </Button>
          </Space>
        </div>

        <div style={{marginBottom: 12, padding: "8px 12px", background: "rgba(22,119,255,0.05)", borderRadius: 6, border: "1px solid rgba(22,119,255,0.15)"}}>
          <Text type="secondary" style={{fontSize: 12}}>
            The same rules are enforced by two in-process webhooks: <strong>ValidatingAdmissionWebhook</strong> (<Text code style={{fontSize: 11}}>casbin-admission</Text>) intercepts write operations before resources are persisted, and <strong>Authorization Webhook</strong> intercepts every API request (get / list / watch / create …) before it reaches RBAC.
            <br />
            <strong>p</strong> = allow policy (subject, namespace, resource, action) · <strong>g</strong> = role assignment (user → role) · <Text code style={{fontSize: 11}}>*</Text> = wildcard · system:* users bypass the authorization webhook. When no rules exist, all requests are allowed.
          </Text>
        </div>

        <Table
          columns={columns}
          dataSource={rules}
          rowKey="id"
          loading={loading}
          pagination={{pageSize: 20}}
          size="middle"
        />

        {this.renderAddModal()}
      </div>
    );
  }
}

export default CasbinRuleListPage;
