import React, {useCallback, useEffect, useRef, useState} from "react";
import {Link, useHistory} from "react-router-dom";
import i18next from "i18next";
import {CloudCog, MonitorCog, Pencil, Plus, Trash2} from "lucide-react";
import * as MachineBackend from "@/backend/MachineBackend";
import * as Setting from "@/Setting";
import {runAction, useResource} from "@/hooks/use-resource";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {SimpleTooltip} from "@/components/ui/tooltip";
import {DataTable} from "@/components/shared/data-table";
import {ConfirmDialog} from "@/components/shared/confirm-dialog";
import {Field, FormDialog} from "@/components/shared/form-dialog";
import {PageContainer} from "@/components/shared/page-header";
import {NumberInput} from "@/components/shared/number-input";
import {PasswordInput} from "@/components/shared/password-input";
import {SimpleSelect} from "@/components/shared/simple-select";
import {MachineNodeDeploySheet} from "@/components/shared/machine-node-deploy-sheet";
import {LocalWSLEnrollDialog} from "@/components/shared/local-wsl-enroll-dialog";

export const MACHINE_STATUS_VARIANTS = {
  Online: "success",
  Offline: "danger",
  Deploying: "info",
  Deployed: "info",
  Failed: "danger",
  Unknown: "muted",
};

const NAME_PATTERN = /^[a-z0-9-]+$/;

// Installing a WSL distribution takes minutes, so its progress is polled.
const WSL_POLL_INTERVAL = 3000;

const emptyForm = {
  name: "",
  displayName: "",
  ip: "",
  port: 22,
  username: "root",
  authType: "password",
  password: "",
  privateKey: "",
};

function MachineListPage({account}) {
  const history = useHistory();
  const {data: machines, setData: setMachines, loading, refresh} = useResource(
    () => MachineBackend.getGlobalMachines(),
    [],
    {initialData: []}
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [wslStatus, setWslStatus] = useState(null);
  const [wslDialogOpen, setWslDialogOpen] = useState(false);
  const [deployMachine, setDeployMachine] = useState(null);

  const wslRunningRef = useRef(false);
  const machinesRefreshRef = useRef(refresh);
  machinesRefreshRef.current = refresh;

  const loadWSLStatus = useCallback(() => {
    return MachineBackend.getLocalWSLMachineStatus()
      .then((res) => {
        if (res.status !== "ok") {
          return null;
        }
        const next = res.data ?? null;
        setWslStatus(next);
        // The run that just ended is the one that changed the machine list, and
        // its result only arrives here, not from the request that started it.
        if (wslRunningRef.current && next && !next.running) {
          machinesRefreshRef.current();
          if (next.error) {
            Setting.showMessage("error", `${i18next.t("machine:Failed to add local WSL machine")}: ${next.error}`);
          } else if (next.result?.machine) {
            const machine = next.result.machine;
            const summary = `${next.result.distro || machine.name} (${machine.username}@${machine.ip}:${machine.port})`;
            // Enrolling is idempotent: a second run refreshes the existing
            // entry rather than failing, and the message says which happened.
            Setting.showMessage(
              "success",
              next.result.created === false
                ? `${i18next.t("machine:Local WSL machine refreshed")}: ${summary}`
                : `${i18next.t("machine:Local WSL machine added")}: ${summary}`
            );
          }
        }
        wslRunningRef.current = Boolean(next?.running);
        return next;
      })
      .catch(() => null);
  }, []);

  // A run started before this page was opened, or before a reload, is still
  // worth watching: it owns the machine this page is waiting for.
  useEffect(() => {
    loadWSLStatus();
  }, [loadWSLStatus]);

  useEffect(() => {
    if (!wslStatus?.running) {
      return undefined;
    }
    const timer = setInterval(loadWSLStatus, WSL_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [wslStatus?.running, loadWSLStatus]);

  function openAdd() {
    setForm(emptyForm);
    setErrors({});
    setDialogOpen(true);
  }

  async function handleDelete(record) {
    const ok = await runAction(MachineBackend.deleteMachine(record), {
      successMessage: i18next.t("general:Successfully deleted"),
    });
    if (ok) {
      setMachines((previous) => previous.filter((machine) => machine.name !== record.name));
    }
  }

  // Enrolling is a background job on the server, because a host without WSL has
  // a distribution to install first. Starting it only opens the progress
  // dialog; the outcome arrives through the poll.
  function addLocalWSL() {
    setWslDialogOpen(true);
    MachineBackend.addLocalWSLMachine()
      .then((res) => {
        if (res.status !== "ok") {
          Setting.showMessage("error", `${i18next.t("machine:Failed to add local WSL machine")}: ${res.msg}`);
          setWslDialogOpen(false);
          return;
        }
        setWslStatus(res.data ?? null);
        wslRunningRef.current = Boolean(res.data?.running);
      })
      .catch((error) => {
        Setting.showMessage("error", `${i18next.t("machine:Failed to add local WSL machine")}: ${error.message}`);
        setWslDialogOpen(false);
      });
  }

  async function handleSubmit() {
    const nextErrors = {};
    if (!form.name) {
      nextErrors.name = i18next.t("general:required");
    } else if (!NAME_PATTERN.test(form.name)) {
      nextErrors.name = "lowercase letters, digits and dashes only";
    }
    if (!form.ip) {
      nextErrors.ip = i18next.t("general:required");
    }
    if (!form.username) {
      nextErrors.username = i18next.t("general:required");
    }
    if (form.authType === "password" && !form.password) {
      nextErrors.password = i18next.t("general:required");
    }
    if (form.authType === "privateKey" && !form.privateKey) {
      nextErrors.privateKey = i18next.t("general:required");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    const ok = await runAction(
      MachineBackend.addMachine({
        owner: "admin",
        name: form.name,
        displayName: form.displayName || form.name,
        ip: form.ip,
        port: Number(form.port),
        username: form.username,
        authType: form.authType,
        password: form.authType === "password" ? form.password : "",
        privateKey: form.authType === "privateKey" ? form.privateKey : "",
        status: "Unknown",
      }),
      {successMessage: i18next.t("general:Successfully added")}
    );
    setSubmitting(false);

    if (ok) {
      setDialogOpen(false);
      refresh();
    }
  }

  const columns = [
    {
      key: "name",
      title: i18next.t("general:Name"),
      dataIndex: "name",
      width: 180,
      sortable: true,
      render: (value) => (
        <Link to={`/machines/${value}`} className="text-info font-medium hover:underline">
          {value}
        </Link>
      ),
    },
    {key: "displayName", title: i18next.t("general:Display name"), dataIndex: "displayName", width: 180},
    {key: "ip", title: i18next.t("machine:IP address"), dataIndex: "ip", width: 160, className: "font-mono text-xs"},
    {key: "port", title: i18next.t("machine:SSH port"), dataIndex: "port", width: 110, align: "right"},
    {key: "username", title: i18next.t("general:Username"), dataIndex: "username", width: 140},
    {key: "role", title: i18next.t("policy:Role"), dataIndex: "role", width: 130, sortable: true},
    {
      key: "status",
      title: i18next.t("general:Status"),
      dataIndex: "status",
      width: 140,
      sortable: true,
      render: (value) => <Badge variant={MACHINE_STATUS_VARIANTS[value] ?? "muted"}>{value || "Unknown"}</Badge>,
    },
    {
      key: "action",
      title: i18next.t("general:Action"),
      width: 160,
      align: "right",
      render: (_, record) => (
        <div className="flex justify-end gap-1">
          <SimpleTooltip title={i18next.t("machine:Deploy worker node", {defaultValue: "Deploy worker node"})}>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeployMachine(record)} aria-label="Deploy worker node">
              <CloudCog className="size-4" />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip title={i18next.t("general:Edit")}>
            <Button variant="ghost" size="icon-sm" onClick={() => history.push(`/machines/${record.name}`)} aria-label="Edit">
              <Pencil className="size-4" />
            </Button>
          </SimpleTooltip>
          <ConfirmDialog
            title={`${i18next.t("general:Sure to delete")}: ${record.name} ?`}
            confirmText={i18next.t("general:OK")}
            cancelText={i18next.t("general:Cancel")}
            onConfirm={() => handleDelete(record)}
          >
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </ConfirmDialog>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <DataTable
        testId="machines-table"
        title={i18next.t("general:Machines")}
        description={`${machines?.length ?? 0} machines`}
        columns={columns}
        dataSource={machines}
        rowKey="name"
        loading={loading}
        searchable
        emptyText={i18next.t("machine:No machines yet")}
        toolbar={
          <>
            <SimpleTooltip title={i18next.t("machine:Add Local WSL - Tooltip")}>
              <Button variant="outline" size="sm" loading={Boolean(wslStatus?.running)} onClick={addLocalWSL}>
                <MonitorCog />
                {i18next.t("machine:Add Local WSL")}
              </Button>
            </SimpleTooltip>
            <Button size="sm" onClick={openAdd}>
              <Plus />
              {i18next.t("general:Add")}
            </Button>
          </>
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={i18next.t("machine:Add Machine")}
        submitText={i18next.t("general:Add")}
        submitting={submitting}
        onSubmit={handleSubmit}
      >
        <Field label={i18next.t("general:Name")} htmlFor="machine-name" required error={errors.name}>
          <Input
            id="machine-name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({...prev, name: event.target.value}))}
            placeholder="my-machine"
          />
        </Field>

        <Field label={i18next.t("general:Display name")} htmlFor="machine-display-name">
          <Input
            id="machine-display-name"
            value={form.displayName}
            onChange={(event) => setForm((prev) => ({...prev, displayName: event.target.value}))}
            placeholder="My Machine"
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Field label={i18next.t("machine:IP address")} htmlFor="machine-ip" required error={errors.ip}>
            <Input
              id="machine-ip"
              value={form.ip}
              onChange={(event) => setForm((prev) => ({...prev, ip: event.target.value}))}
              placeholder="192.168.1.10"
              className="font-mono text-xs"
            />
          </Field>
          <Field label={i18next.t("machine:SSH port")}>
            <NumberInput value={form.port} onChange={(next) => setForm((prev) => ({...prev, port: next}))} min={1} max={65535} />
          </Field>
        </div>

        <Field label={i18next.t("general:Username")} htmlFor="machine-username" required error={errors.username}>
          <Input
            id="machine-username"
            value={form.username}
            onChange={(event) => setForm((prev) => ({...prev, username: event.target.value}))}
            placeholder="root"
          />
        </Field>

        <Field label={i18next.t("machine:Auth type")}>
          <SimpleSelect
            value={form.authType}
            onChange={(next) => setForm((prev) => ({...prev, authType: next}))}
            options={[
              {label: i18next.t("general:Password"), value: "password"},
              {label: i18next.t("machine:Private key"), value: "privateKey"},
            ]}
          />
        </Field>

        {form.authType === "privateKey" ? (
          <Field label={i18next.t("machine:Private key")} htmlFor="machine-key" required error={errors.privateKey}>
            <Textarea
              id="machine-key"
              rows={5}
              value={form.privateKey}
              onChange={(event) => setForm((prev) => ({...prev, privateKey: event.target.value}))}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              className="font-mono text-xs"
            />
          </Field>
        ) : (
          <Field label={i18next.t("general:Password")} htmlFor="machine-password" required error={errors.password}>
            <PasswordInput
              id="machine-password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({...prev, password: event.target.value}))}
            />
          </Field>
        )}
      </FormDialog>

      <LocalWSLEnrollDialog open={wslDialogOpen} onOpenChange={setWslDialogOpen} status={wslStatus} />

      <MachineNodeDeploySheet
        open={deployMachine !== null}
        machine={deployMachine}
        account={account}
        onClose={() => {
          setDeployMachine(null);
          refresh();
        }}
      />
    </PageContainer>
  );
}

export default MachineListPage;
