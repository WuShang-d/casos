import React from "react";
import {Link} from "react-router-dom";
import {Button, Popconfirm, Table, Tooltip} from "antd";
import {DeleteOutlined, EditOutlined} from "@ant-design/icons";
import * as Setting from "./Setting";
import * as SiteBackend from "./backend/SiteBackend";
import i18next from "i18next";

class SiteListPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      sites: [],
      loading: false,
    };
  }

  UNSAFE_componentWillMount() {
    this.getSites();
  }

  getSites() {
    this.setState({loading: true});
    SiteBackend.getGlobalSites()
      .then((res) => {
        this.setState({loading: false});
        if (res.status === "ok") {
          this.setState({sites: res.data || []});
        } else {
          Setting.showMessage("error", res.msg);
        }
      });
  }

  deleteSite(record) {
    SiteBackend.deleteSite(record)
      .then((res) => {
        if (res.status === "ok") {
          Setting.showMessage("success", i18next.t("general:Successfully deleted"));
          this.setState({sites: this.state.sites.filter(s => s.name !== record.name)});
        } else {
          Setting.showMessage("error", `${i18next.t("general:Failed to delete")}: ${res.msg}`);
        }
      });
  }

  render() {
    const columns = [
      {
        title: i18next.t("general:Name"),
        dataIndex: "name",
        key: "name",
        width: "200px",
        render: (text) => <Link to={`/sites/${text}`}>{text}</Link>,
      },
      {
        title: i18next.t("general:Display name"),
        dataIndex: "displayName",
        key: "displayName",
        width: "200px",
      },
      {
        title: i18next.t("site:Theme color"),
        dataIndex: "themeColor",
        key: "themeColor",
        width: "120px",
        render: (text) => (
          <span>
            <span style={{display: "inline-block", width: "16px", height: "16px", backgroundColor: text, borderRadius: "3px", marginRight: "8px", verticalAlign: "middle", border: "1px solid #d9d9d9"}} />
            {text}
          </span>
        ),
      },
      {
        title: i18next.t("general:Action"),
        dataIndex: "action",
        key: "action",
        width: "130px",
        fixed: "right",
        render: (text, record) => (
          <div style={{display: "flex", alignItems: "center", gap: "2px"}}>
            <Tooltip title={i18next.t("general:Edit")}>
              <Button type="text" size="small" icon={<EditOutlined />} style={{width: "28px", height: "28px", padding: 0, borderRadius: "6px"}} onClick={() => this.props.history.push(`/sites/${record.name}`)} />
            </Tooltip>
            <Popconfirm
              title={`${i18next.t("general:Sure to delete")}: ${record.name} ?`}
              onConfirm={() => this.deleteSite(record)}
              okText={i18next.t("general:OK")}
              cancelText={i18next.t("general:Cancel")}
              disabled={record.name === "site-built-in"}
            >
              <Tooltip title={i18next.t("general:Delete")}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{width: "28px", height: "28px", padding: 0, borderRadius: "6px"}} disabled={record.name === "site-built-in"} />
              </Tooltip>
            </Popconfirm>
          </div>
        ),
      },
    ];

    return (
      <div style={{padding: "16px"}}>
        <Table
          scroll={{x: "max-content"}}
          columns={columns}
          dataSource={this.state.sites}
          rowKey="name"
          size="middle"
          bordered
          loading={this.state.loading}
          title={() => (
            <div>
              {i18next.t("general:Sites")}&nbsp;&nbsp;&nbsp;&nbsp;
              <Button type="primary" size="small" disabled>{i18next.t("general:Add")}</Button>
            </div>
          )}
        />
      </div>
    );
  }
}

export default SiteListPage;
