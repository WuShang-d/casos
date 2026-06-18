import React from "react";
import {Button, Input, Select, Typography} from "antd";
import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons";

const {Text} = Typography;

export const ENV_SOURCE_PLAIN = "plain";
export const ENV_SOURCE_CONFIGMAP = "configmap";
export const ENV_SOURCE_SECRET = "secret";

/**
 * Props:
 *   value        {Array}   - list of env var rows
 *   onChange     {Function}  - called with updated list
 *   configMaps   {Array}   - [{name, data: {key: val}}]
 *   secrets      {Array}   - [{name, stringData: {key: val}}]
 */
function EnvVarEditor({value = [], onChange, configMaps = [], secrets = []}) {
  function update(index, field, val) {
    const next = [...value];
    if (field === "source") {
      next[index] = {source: val, name: next[index].name};
    } else {
      next[index] = {...next[index], [field]: val};
    }
    onChange(next);
  }

  function add() {
    onChange([...value, {source: ENV_SOURCE_PLAIN, name: "", value: ""}]);
  }

  function remove(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  function renderRow(ev, index) {
    const cmOptions = configMaps.map(cm => ({label: cm.name, value: cm.name}));
    const secretOptions = secrets.map(s => ({label: s.name, value: s.name}));

    const selectedCm = configMaps.find(cm => cm.name === ev.configMapName);
    const cmKeyOptions = Object.keys(selectedCm?.data ?? {}).map(k => ({label: k, value: k}));

    const selectedSecret = secrets.find(s => s.name === ev.secretName);
    const secretKeyOptions = Object.keys(selectedSecret?.stringData ?? {}).map(k => ({label: k, value: k}));

    return (
      <div key={index} style={{display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8}}>
        <Select
          style={{width: 110, flexShrink: 0}}
          value={ev.source}
          onChange={v => update(index, "source", v)}
          options={[
            {label: "Plain", value: ENV_SOURCE_PLAIN},
            {label: "ConfigMap", value: ENV_SOURCE_CONFIGMAP},
            {label: "Secret", value: ENV_SOURCE_SECRET},
          ]}
          size="small"
        />
        <Input
          style={{width: 140, flexShrink: 0}}
          placeholder="VAR_NAME"
          value={ev.name}
          onChange={e => update(index, "name", e.target.value)}
          size="small"
        />
        {ev.source === ENV_SOURCE_PLAIN && (
          <Input
            style={{flex: 1}}
            placeholder="value"
            value={ev.value ?? ""}
            onChange={e => update(index, "value", e.target.value)}
            size="small"
          />
        )}
        {ev.source === ENV_SOURCE_CONFIGMAP && (
          <>
            <Select
              style={{flex: 1}}
              placeholder="ConfigMap"
              value={ev.configMapName || undefined}
              onChange={v => update(index, "configMapName", v)}
              options={cmOptions}
              size="small"
              showSearch
            />
            <Select
              style={{flex: 1}}
              placeholder="Key"
              value={ev.configMapKey || undefined}
              onChange={v => update(index, "configMapKey", v)}
              options={cmKeyOptions}
              size="small"
              showSearch
              disabled={!ev.configMapName}
            />
          </>
        )}
        {ev.source === ENV_SOURCE_SECRET && (
          <>
            <Select
              style={{flex: 1}}
              placeholder="Secret"
              value={ev.secretName || undefined}
              onChange={v => update(index, "secretName", v)}
              options={secretOptions}
              size="small"
              showSearch
            />
            <Select
              style={{flex: 1}}
              placeholder="Key"
              value={ev.secretKey || undefined}
              onChange={v => update(index, "secretKey", v)}
              options={secretKeyOptions}
              size="small"
              showSearch
              disabled={!ev.secretName}
            />
          </>
        )}
        <Button
          type="text"
          danger
          icon={<MinusCircleOutlined />}
          size="small"
          onClick={() => remove(index)}
          style={{flexShrink: 0}}
        />
      </div>
    );
  }

  return (
    <div>
      {value.length > 0 && (
        <div style={{marginBottom: 4}}>
          <div style={{display: "flex", gap: 8, marginBottom: 4}}>
            <Text type="secondary" style={{width: 110, fontSize: 12, flexShrink: 0}}>Source</Text>
            <Text type="secondary" style={{width: 140, fontSize: 12, flexShrink: 0}}>Variable Name</Text>
            <Text type="secondary" style={{flex: 1, fontSize: 12}}>Value / Reference</Text>
          </div>
          {value.map((ev, i) => renderRow(ev, i))}
        </div>
      )}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        size="small"
        onClick={add}
        style={{width: "100%"}}
      >
        Add Environment Variable
      </Button>
    </div>
  );
}

export default EnvVarEditor;
