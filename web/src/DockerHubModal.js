import React from "react";
import {Alert, Card, Input, Modal, Space, Spin, Tooltip} from "antd";
import {AppstoreOutlined, CheckCircleFilled, SearchOutlined, StarFilled} from "@ant-design/icons";
import * as PodBackend from "./backend/PodBackend";

function formatPullCount(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

class DockerHubModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      query: "",
      results: [],
      loading: false,
      error: null,
    };
    this._searchTimer = null;
  }

  componentDidUpdate(prevProps) {
    if (!prevProps.open && this.props.open) {
      this.setState({query: "", results: [], error: null}, () => this.search("nginx"));
    }
  }

  componentWillUnmount() {
    clearTimeout(this._searchTimer);
  }

  search(q) {
    if (!q.trim()) {
      this.setState({results: [], error: null});
      return;
    }
    this.setState({loading: true, error: null});
    PodBackend.searchDockerHubImages(q).then(res => {
      if (res.status === "ok") {
        this.setState({results: res.data ?? []});
      } else {
        this.setState({error: res.msg});
      }
    }).catch(e => {
      this.setState({error: e.message});
    }).finally(() => {
      this.setState({loading: false});
    });
  }

  handleQueryChange(q) {
    this.setState({query: q});
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.search(q), 400);
  }

  handleSelect(imageName) {
    this.props.onSelect(`${imageName}:latest`);
  }

  render() {
    const {open, onCancel} = this.props;
    const {query, results, loading, error} = this.state;

    return (
      <Modal
        title={
          <Space>
            <AppstoreOutlined style={{color: "#1677ff"}} />
            Docker Hub
          </Space>
        }
        open={open}
        onCancel={onCancel}
        footer={null}
        width={680}
        destroyOnHidden
      >
        <Input
          prefix={<SearchOutlined style={{color: "#bfbfbf"}} />}
          placeholder="Search Docker Hub images…"
          value={query}
          onChange={e => this.handleQueryChange(e.target.value)}
          allowClear
          autoFocus
          style={{marginBottom: 16}}
        />
        {error && (
          <Alert type="error" message={error} style={{marginBottom: 12}} showIcon />
        )}
        <Spin spinning={loading}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
            maxHeight: 460,
            overflowY: "auto",
            paddingRight: 4,
          }}>
            {results.map(img => (
              <Card
                key={img.name}
                size="small"
                hoverable
                style={{cursor: "pointer"}}
                styles={{body: {padding: "10px 14px"}}}
                onClick={() => this.handleSelect(img.name)}
              >
                <div style={{display: "flex", flexDirection: "column", gap: 4}}>
                  <div style={{display: "flex", alignItems: "center", gap: 6}}>
                    <span style={{fontWeight: 600, fontSize: 13, color: "#262626", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
                      {img.name}
                    </span>
                    {img.isOfficial && (
                      <Tooltip title="Official Image">
                        <CheckCircleFilled style={{color: "#1677ff", fontSize: 13}} />
                      </Tooltip>
                    )}
                  </div>
                  {img.description && (
                    <div style={{fontSize: 11, color: "#8c8c8c", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden"}}>
                      {img.description}
                    </div>
                  )}
                  <div style={{display: "flex", gap: 8, fontSize: 11, color: "#bfbfbf", marginTop: 2}}>
                    <span><StarFilled style={{fontSize: 10, marginRight: 2}} />{img.starCount?.toLocaleString()}</span>
                    <span>↓ {formatPullCount(img.pullCount)}</span>
                  </div>
                </div>
              </Card>
            ))}
            {!loading && results.length === 0 && query && (
              <div style={{gridColumn: "1/-1", textAlign: "center", color: "#bfbfbf", padding: 32}}>
                No results for "{query}"
              </div>
            )}
          </div>
        </Spin>
      </Modal>
    );
  }
}

export default DockerHubModal;
