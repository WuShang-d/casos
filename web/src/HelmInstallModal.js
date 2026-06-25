import React, {useEffect, useRef, useState} from "react";
import {Alert, Button, Form, Input, Modal, Select, Spin, Typography} from "antd";
import {useTranslation} from "react-i18next";
import * as HelmBackend from "./backend/HelmBackend";
import * as NamespaceBackend from "./backend/NamespaceBackend";

const {Text} = Typography;

export default function HelmInstallModal({open, chart, onClose, onInstalled}) {
  const {t} = useTranslation();
  const [form] = Form.useForm();
  const [namespaces, setNamespaces] = useState([]);
  const [valuesYAML, setValuesYAML] = useState("");
  const [valuesLoading, setValuesLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);
  const abortCtrlRef = useRef(null);

  useEffect(() => {
    if (!open || !chart) {return;}
    setError(null);
    setLogs([]);
    setDone(false);
    setAborted(false);

    NamespaceBackend.getNamespaces().then(res => {
      if (res.status === "ok") {
        const ns = res.data ?? [];
        setNamespaces(ns);
        const def = ns.find(n => n.name === "default") ? "default" : (ns[0]?.name ?? "default");
        form.setFieldsValue({
          releaseName: chart.chartName,
          namespace: def,
          version: chart.version ?? "",
        });
      }
    });

    if (chart.chartName && chart.repoURL) {
      setValuesLoading(true);
      setValuesYAML("");
      HelmBackend.getHelmChartValues(chart.chartName, chart.repoURL, chart.version ?? "")
        .then(res => {
          if (res.status === "ok") {
            setValuesYAML(res.data ?? "");
          } else {
            setError(res.msg);
          }
        })
        .finally(() => setValuesLoading(false));
    }
  }, [open, chart, form]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({behavior: "smooth"});
    }
  }, [logs]);

  const handleClose = () => {
    form.resetFields();
    setValuesYAML("");
    setError(null);
    setLogs([]);
    setDone(false);
    setAborted(false);
    setInstalling(false);
    onClose();
  };

  const handleAbort = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
  };

  const handleOk = () => {
    if (done || aborted) {
      if (done) {onInstalled?.();}
      handleClose();
      return;
    }
    form.validateFields().then(values => {
      setInstalling(true);
      setAborted(false);
      setError(null);
      setLogs([]);

      const ctrl = new AbortController();
      abortCtrlRef.current = ctrl;

      HelmBackend.installHelmChartStream(
        {
          releaseName: values.releaseName,
          namespace: values.namespace,
          chartName: chart.chartName,
          repoURL: chart.repoURL,
          version: values.version || chart.version,
          valuesYAML,
        },
        line => {
          if (line === "ABORTED") {
            setAborted(true);
          } else {
            setLogs(prev => [...prev, line]);
          }
        },
        ctrl.signal
      )
        .then(() => {
          setDone(true);
          onInstalled?.();
        })
        .catch(e => {
          if (e.name !== "AbortError") {
            setError(e.message);
          }
        })
        .finally(() => setInstalling(false));
    });
  };

  if (!chart) {return null;}

  const nsOptions = namespaces.map(ns => ({label: ns.name, value: ns.name}));
  const showLog = installing || done || aborted || (error && logs.length > 0);

  const lineColor = (line, i, total) => {
    if (line.startsWith("ERROR")) {return "#f87171";}
    if (done && i === total - 1) {return "#4ade80";}
    return "#d4d4d4";
  };

  return (
    <Modal
      title={
        <span>
          {t("helm:Install chart")} <Text code>{chart.chartName}</Text>
          {chart.repoURL && (
            <Text style={{marginLeft: 8, fontSize: 12, color: "rgba(0,0,0,0.45)"}}>
              {chart.repoURL}
            </Text>
          )}
        </span>
      }
      open={open}
      onCancel={installing ? undefined : handleClose}
      closable={!installing}
      maskClosable={!installing}
      footer={
        <div style={{display: "flex", justifyContent: "flex-end", gap: 8}}>
          {installing && (
            <Button danger onClick={handleAbort}>{t("helm:Abort")}</Button>
          )}
          {!installing && (
            <Button onClick={handleClose}>
              {done || aborted ? t("general:Close") : t("general:Cancel")}
            </Button>
          )}
          {!done && !aborted && (
            <Button type="primary" loading={installing} onClick={handleOk}>
              {t("helm:Install")}
            </Button>
          )}
          {(done || aborted) && (
            <Button type="primary" onClick={handleOk}>
              {t("general:Done")}
            </Button>
          )}
        </div>
      }
      width={700}
      destroyOnHidden
    >
      {error && (
        <Alert type="error" message={error} showIcon style={{marginBottom: 16}} closable onClose={() => setError(null)} />
      )}
      {aborted && (
        <Alert type="warning" message={t("helm:Install aborted")} showIcon style={{marginBottom: 16}} />
      )}

      {!showLog && (
        <Form form={form} layout="vertical">
          <div style={{display: "flex", gap: 12}}>
            <Form.Item
              style={{flex: 1}}
              label={t("helm:Release name")}
              name="releaseName"
              rules={[
                {required: true},
                {pattern: /^[a-z0-9][a-z0-9-]*$/, message: t("helm:Release name pattern")},
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item style={{flex: 1}} label={t("general:Namespaces")} name="namespace" rules={[{required: true}]}>
              <Select options={nsOptions} showSearch />
            </Form.Item>
            <Form.Item style={{width: 130}} label={t("helm:Version")} name="version">
              <Input placeholder={chart.version ?? "latest"} />
            </Form.Item>
          </div>

          <Form.Item label={t("helm:Values (YAML)")}>
            {valuesLoading ? (
              <div style={{textAlign: "center", padding: 24}}>
                <Spin size="small" />
                <Text style={{marginLeft: 8, color: "rgba(0,0,0,0.45)"}}>{t("helm:Loading values")}</Text>
              </div>
            ) : (
              <textarea
                value={valuesYAML}
                onChange={e => setValuesYAML(e.target.value)}
                rows={14}
                style={{
                  width: "100%", fontFamily: "monospace", fontSize: 12,
                  padding: "8px 10px", borderRadius: 6,
                  border: "1px solid #d9d9d9", resize: "vertical", outline: "none",
                  boxSizing: "border-box",
                }}
                spellCheck={false}
              />
            )}
          </Form.Item>
        </Form>
      )}

      {showLog && (
        <div
          style={{
            background: "#1a1a1a", borderRadius: 6, padding: "10px 14px",
            fontFamily: "monospace", fontSize: 12, color: "#d4d4d4",
            height: 340, overflowY: "auto", lineHeight: 1.6,
          }}
        >
          {logs.length === 0 && installing && (
            <span style={{color: "#888"}}>
              <Spin size="small" style={{marginRight: 8}} />
              {t("helm:Installing")}...
            </span>
          )}
          {logs.map((line, i) => (
            <div key={i} style={{color: lineColor(line, i, logs.length)}}>
              {line}
            </div>
          ))}
          {installing && logs.length > 0 && (
            <span style={{color: "#888", display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4}}>
              <Spin size="small" />
            </span>
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </Modal>
  );
}
