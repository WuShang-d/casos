import React, {useEffect, useState} from "react";
import {Button, Checkbox, Modal, Space, Tag, Typography} from "antd";
import {ReloadOutlined} from "@ant-design/icons";
import * as DeploymentBackend from "./backend/DeploymentBackend";
import * as Setting from "./Setting";

const {Text} = Typography;

function findAffectedDeployments(deployments, namespace, configType, configName) {
  return deployments.filter(d => {
    if (d.namespace !== namespace) {return false;}
    return (d.envVars ?? []).some(e => {
      if (configType === "configmap") {return e.configMapName === configName;}
      if (configType === "secret") {return e.secretName === configName;}
      return false;
    });
  });
}

function RestartDeploymentsModal({open, onClose, namespace, configType, configName}) {
  const [affected, setAffected] = useState([]);
  const [selected, setSelected] = useState([]);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!open) {return;}
    DeploymentBackend.getDeployments(namespace).then(res => {
      if (res.status === "ok") {
        const all = res.data ?? [];
        const aff = findAffectedDeployments(all, namespace, configType, configName);
        setAffected(aff);
        setSelected(aff.map(d => d.name));
      }
    }).catch(() => {});
  }, [open, namespace, configType, configName]);

  function handleRestart() {
    if (selected.length === 0) {onClose(); return;}
    setRestarting(true);
    Promise.all(
      selected.map(name => DeploymentBackend.restartDeployment(namespace, name))
    ).then(results => {
      const failed = results.filter(r => r.status !== "ok");
      if (failed.length === 0) {
        Setting.showMessage("success", `Restarted ${selected.length} deployment(s)`);
      } else {
        Setting.showMessage("error", `${failed.length} restart(s) failed`);
      }
      onClose();
    }).catch(e => Setting.showMessage("error", e.message))
      .finally(() => setRestarting(false));
  }

  const label = configType === "secret" ? "Secret" : "ConfigMap";

  return (
    <Modal
      title={<span><ReloadOutlined style={{marginRight: 8, color: "#1677ff"}} />Restart Apps After Config Update</span>}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Skip</Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={handleRestart}
            loading={restarting}
            disabled={selected.length === 0}
          >
            Restart {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </Space>
      }
      width={480}
      destroyOnHidden
    >
      {affected.length === 0 ? (
        <Text type="secondary">
          No deployments in <Text code>{namespace}</Text> reference this {label} via environment variables.
          You can still manually restart apps from the Deployments page.
        </Text>
      ) : (
        <>
          <Text>
            The following deployments reference <Text code>{configName}</Text> and may need a restart to pick up the new config:
          </Text>
          <div style={{marginTop: 12}}>
            <Checkbox.Group
              value={selected}
              onChange={setSelected}
              style={{display: "flex", flexDirection: "column", gap: 8}}
            >
              {affected.map(d => (
                <Checkbox key={d.name} value={d.name}>
                  <Text code>{d.name}</Text>
                  <Tag color="blue" style={{marginLeft: 8, fontSize: 11}}>{d.namespace}</Tag>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
        </>
      )}
    </Modal>
  );
}

export default RestartDeploymentsModal;
