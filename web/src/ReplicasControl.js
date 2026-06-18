import React, {useState} from "react";
import {Button, InputNumber, Space, Tooltip} from "antd";
import {CheckOutlined, CloseOutlined, EditOutlined, MinusOutlined, PlusOutlined} from "@ant-design/icons";

/**
 * Props:
 *   readyReplicas  {number}
 *   replicas       {number}
 *   onScale        {Function(newReplicas)} - returns a Promise
 */
function ReplicasControl({readyReplicas = 0, replicas = 0, onScale}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(replicas);
  const [loading, setLoading] = useState(false);

  function startEdit() {
    setValue(replicas);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
  }

  function confirm(newVal) {
    const next = Math.max(0, newVal ?? value);
    if (next === replicas) {
      setEditing(false);
      return;
    }
    setLoading(true);
    onScale(next).finally(() => {
      setLoading(false);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <Space size={4}>
        <Button
          size="small"
          icon={<MinusOutlined />}
          disabled={value <= 0}
          onClick={() => setValue(v => Math.max(0, v - 1))}
        />
        <InputNumber
          size="small"
          min={0}
          value={value}
          onChange={v => setValue(v ?? 0)}
          onPressEnter={() => confirm(value)}
          style={{width: 52}}
          controls={false}
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setValue(v => v + 1)}
        />
        <Button
          size="small"
          type="primary"
          icon={<CheckOutlined />}
          loading={loading}
          onClick={() => confirm(value)}
        />
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={cancel}
          disabled={loading}
        />
      </Space>
    );
  }

  return (
    <Space size={4}>
      <span>{readyReplicas} / {replicas}</span>
      <Tooltip title="Scale">
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={startEdit}
          style={{color: "var(--ant-color-text-tertiary)"}}
        />
      </Tooltip>
    </Space>
  );
}

export default ReplicasControl;
