import React, {useState} from "react";
import i18next from "i18next";
import {Ban, CheckCircle2, Cpu, HardDrive, KeyRound, Pencil, RefreshCw, Trash2, Zap} from "lucide-react";
import * as NodeBackend from "@/backend/NodeBackend";
import * as Setting from "@/Setting";
import {runAction, useResource} from "@/hooks/use-resource";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Progress} from "@/components/ui/progress";
import {Textarea} from "@/components/ui/textarea";
import {MessageAlert} from "@/components/ui/alert";
import {SimpleTooltip} from "@/components/ui/tooltip";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {DataTable} from "@/components/shared/data-table";
import {ConfirmDialog} from "@/components/shared/confirm-dialog";
import {Field, FormDialog} from "@/components/shared/form-dialog";
import {PageContainer} from "@/components/shared/page-header";
import {KeyValueEditor, fromEntries, toEntries} from "@/components/shared/key-value-editor";
import {CodeText} from "@/components/shared/misc";
import {StatCard} from "@/components/shared/stat-card";

const STATUS_VARIANTS = {Ready: "success", NotReady: "danger", Unknown: "muted"};

// Setting.getFormattedDate drops the time of day, and a denial seconds old has
// to be distinguishable from one an hour old.
function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const formatCores = (milli) => `${Number((milli / 1000).toFixed(1))} ${i18next.t("general:cores")}`;
const formatMiB = (mib) => (mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`);

function isSchedulable(node) {
  return node.status === "Ready" && !node.unschedulable && Boolean(node.allocation);
}

function AllocationCell({requested, allocatable, free, format}) {
  if (!allocatable) {
    return <span className="text-muted-foreground">—</span>;
  }
  const percent = Math.min(100, Math.round((requested * 100) / allocatable));
  return (
    <SimpleTooltip title={i18next.t("node:{{requested}} of {{allocatable}} requested", {requested: format(requested), allocatable: format(allocatable)})}>
      <div className="grid gap-1">
        <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
          <span className="font-medium">{format(free)}</span>
          <span className="text-muted-foreground">/ {format(allocatable)}</span>
        </div>
        <Progress value={percent} tone={percent >= 90 ? "danger" : percent >= 70 ? "warning" : "default"} className="h-1.5" />
      </div>
    </SimpleTooltip>
  );
}

function GpuCell({allocation}) {
  if (!allocation?.gpuAllocatable) {
    return <span className="text-muted-foreground">—</span>;
  }
  const models = allocation.gpus.map((gpu) => gpu.product || gpu.resource).join(", ");
  return (
    <div className="grid gap-0.5">
      <Badge variant={allocation.gpuFree > 0 ? "success" : "muted"} className="w-fit tabular-nums">
        {allocation.gpuFree} / {allocation.gpuAllocatable}
      </Badge>
      <span className="text-muted-foreground max-w-[12rem] truncate text-xs" title={models}>{models}</span>
    </div>
  );
}

// The node condition never names the request that was rejected, so every denial
// the webhook recorded for this node's kubelet is listed. One line per resource
// matters: a locked-out kubelet is denied on its lease, its node status and its
// events at once, and each of those is a different missing policy rule.
function AdmissionDenialDetail({denials}) {
  return (
    <div className="rounded-md bg-warning/10 px-2 py-1.5 text-xs" data-testid="node-admission-denial">
      <p className="font-medium">
        {i18next.t("node:Rejected by the CasOS admission webhook")} — {denials[0].subject}
      </p>
      <ul className="mt-1 space-y-0.5 font-mono">
        {denials.map((denial) => (
          <li key={`${denial.namespace}/${denial.resource}/${denial.operation}`}>
            {denial.operation} {denial.resource}
            {denial.namespace && denial.namespace !== "*" ? ` (${denial.namespace})` : ""}
            {" — "}
            {i18next.t("node:{{times}} times, last at {{time}}", {
              times: denial.count,
              time: formatTimestamp(denial.lastSeen),
            })}
          </li>
        ))}
      </ul>
      <p className="mt-1 opacity-80">{denials[0].message}</p>
    </div>
  );
}

function NodeListPage() {
  const {data: nodes, loading, error, refresh} = useResource(() => NodeBackend.getNodes(), [], {initialData: []});

  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [labelEntries, setLabelEntries] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const [kubeconfigOpen, setKubeconfigOpen] = useState(false);
  const [kubeconfigNode, setKubeconfigNode] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [kubeconfigLoading, setKubeconfigLoading] = useState(false);

  async function handleCordon(node, unschedulable) {
    const ok = await runAction(
      NodeBackend.updateNode({
        name: node.name,
        labels: node.labels,
        unschedulable,
        resourceVersion: node.resourceVersion,
      }),
      {successMessage: unschedulable ? "Node cordoned" : "Node uncordoned"}
    );
    if (ok) {
      refresh();
    }
  }

  function openLabelDialog(node) {
    setEditingNode(node);
    setLabelEntries(toEntries(node.labels));
    setLabelDialogOpen(true);
  }

  async function handleLabelSubmit() {
    setSubmitting(true);
    const ok = await runAction(
      NodeBackend.updateNode({
        name: editingNode.name,
        labels: fromEntries(labelEntries),
        unschedulable: editingNode.unschedulable,
        resourceVersion: editingNode.resourceVersion,
      }),
      {successMessage: "Node labels updated"}
    );
    setSubmitting(false);
    if (ok) {
      setLabelDialogOpen(false);
      refresh();
    }
  }

  async function handleDelete(name) {
    const ok = await runAction(NodeBackend.deleteNode(name), {successMessage: "Node removed from cluster"});
    if (ok) {
      refresh();
    }
  }

  function openKubeconfig(nodeName) {
    setKubeconfigNode(nodeName);
    setKubeconfig("");
    setKubeconfigLoading(true);
    setKubeconfigOpen(true);
    NodeBackend.getWorkerKubeconfig(nodeName)
      .then((res) => {
        setKubeconfig(res.status === "ok" ? res.data?.kubeconfig ?? "" : "");
        if (res.status !== "ok") {
          Setting.showMessage("error", res.msg);
        }
      })
      .catch(() => setKubeconfig(""))
      .finally(() => setKubeconfigLoading(false));
  }

  const notReadyNodes = (nodes ?? []).filter((node) => node.status !== "Ready");
  const schedulableNodes = (nodes ?? []).filter(isSchedulable);
  const hasAllocation = (nodes ?? []).some((node) => node.allocation);
  const hasGpus = (nodes ?? []).some((node) => node.allocation?.gpuAllocatable > 0);
  const totals = schedulableNodes.reduce(
    (sum, node) => ({
      cpuFreeM: sum.cpuFreeM + node.allocation.cpuFreeM,
      memFreeMi: sum.memFreeMi + node.allocation.memFreeMi,
      gpuFree: sum.gpuFree + node.allocation.gpuFree,
      gpuAllocatable: sum.gpuAllocatable + node.allocation.gpuAllocatable,
    }),
    {cpuFreeM: 0, memFreeMi: 0, gpuFree: 0, gpuAllocatable: 0}
  );

  const columns = [
    {
      key: "name",
      title: i18next.t("general:Name"),
      dataIndex: "name",
      sortable: true,
      render: (name, record) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          {record.unschedulable ? <Badge variant="warning">SchedulingDisabled</Badge> : null}
          {record.taints?.length > 0 ? (
            <SimpleTooltip title={record.taints.join(", ")}>
              <span><Badge variant="muted">{i18next.t("node:Tainted")}</Badge></span>
            </SimpleTooltip>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      title: i18next.t("general:Status"),
      dataIndex: "status",
      width: 180,
      sortable: true,
      // A bare "NotReady" badge tells an operator nothing they can act on. The
      // Ready condition's reason goes under the badge and its full message into
      // the tooltip, so the cluster's own explanation is one hover away.
      render: (value, record) => {
        const badge = <Badge variant={STATUS_VARIANTS[value] ?? "muted"}>{value}</Badge>;
        if (!record.statusReason && !record.statusMessage) {
          return badge;
        }
        const detail = [
          record.statusMessage,
          record.lastHeartbeat ? `${i18next.t("node:Last heartbeat")}: ${record.lastHeartbeat} UTC` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <SimpleTooltip title={detail}>
            <span className="flex flex-col items-start gap-1" data-testid={`node-status-${record.name}`}>
              {badge}
              <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
                {record.statusReason || record.statusMessage}
              </span>
            </span>
          </SimpleTooltip>
        );
      },
    },
    {
      key: "roles",
      title: "Roles",
      dataIndex: "roles",
      width: 150,
      render: (roles) => (
        <div className="flex flex-wrap gap-1">
          {(roles ?? []).map((role) => (
            <Badge key={role} variant="muted">
              {role}
            </Badge>
          ))}
        </div>
      ),
    },
    ...(hasAllocation
      ? [
        {
          key: "cpu",
          title: i18next.t("node:CPU free"),
          dataIndex: "allocation.cpuFreeM",
          minWidth: 150,
          sortable: true,
          render: (_, record) => (
            <AllocationCell
              requested={record.allocation?.cpuRequestedM}
              allocatable={record.allocation?.cpuAllocatableM}
              free={record.allocation?.cpuFreeM}
              format={formatCores}
            />
          ),
        },
        {
          key: "memory",
          title: i18next.t("node:Memory free"),
          dataIndex: "allocation.memFreeMi",
          minWidth: 150,
          sortable: true,
          render: (_, record) => (
            <AllocationCell
              requested={record.allocation?.memRequestedMi}
              allocatable={record.allocation?.memAllocatableMi}
              free={record.allocation?.memFreeMi}
              format={formatMiB}
            />
          ),
        },
      ]
      : []),
    ...(hasGpus
      ? [
        {
          key: "gpu",
          title: i18next.t("node:GPUs free"),
          dataIndex: "allocation.gpuFree",
          width: 150,
          sortable: true,
          render: (_, record) => <GpuCell allocation={record.allocation} />,
        },
      ]
      : []),
    {key: "kubeletVersion", title: "Kubelet", dataIndex: "kubeletVersion", width: 130, sortable: true},
    {
      key: "osArch",
      title: "OS / Arch",
      width: 150,
      render: (_, record) => (record.os ? `${record.os} / ${record.arch}` : "—"),
    },
    {key: "createdAt", title: i18next.t("general:Created"), dataIndex: "createdAt", width: 190, sortable: true},
    {
      key: "actions",
      title: i18next.t("general:Action"),
      width: 330,
      align: "right",
      render: (_, record) => (
        <div className="flex justify-end gap-2">
          <SimpleTooltip title={record.unschedulable ? "Re-enable scheduling" : "Disable scheduling"}>
            <Button variant="outline" size="sm" onClick={() => handleCordon(record, !record.unschedulable)}>
              {record.unschedulable ? <CheckCircle2 /> : <Ban />}
              {record.unschedulable ? "Uncordon" : "Cordon"}
            </Button>
          </SimpleTooltip>
          <Button variant="outline" size="sm" onClick={() => openLabelDialog(record)}>
            <Pencil />
            Labels
          </Button>
          <SimpleTooltip title="Generate kubeconfig for this node">
            <Button variant="outline" size="sm" onClick={() => openKubeconfig(record.name)}>
              <KeyRound />
              Kubeconfig
            </Button>
          </SimpleTooltip>
          <ConfirmDialog
            title={`Remove node "${record.name}" from cluster?`}
            description="This removes the node record. The kubelet process is not stopped."
            confirmText="Remove"
            onConfirm={() => handleDelete(record.name)}
          >
            <Button variant="outline" size="sm" className="text-destructive">
              <Trash2 />
            </Button>
          </ConfirmDialog>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      {error ? <MessageAlert title="Failed to fetch nodes" description={error} /> : null}

      {notReadyNodes.length > 0 ? (
        <MessageAlert
          variant="warning"
          data-testid="nodes-not-ready-alert"
          title={i18next.t("node:Some nodes are not Ready")}
          description={
            <>
              {notReadyNodes.map((node) => (
                <React.Fragment key={node.name}>
                  <p>
                    <span className="font-medium">{node.name}</span>
                    {node.statusReason ? ` — ${node.statusReason}` : ""}
                    {node.statusMessage ? `: ${node.statusMessage}` : ""}
                    {node.lastHeartbeat ? ` (${i18next.t("node:Last heartbeat")}: ${node.lastHeartbeat} UTC)` : ""}
                  </p>
                  {node.admissionDenials?.length ? <AdmissionDenialDetail denials={node.admissionDenials} /> : null}
                </React.Fragment>
              ))}
              {notReadyNodes.every((node) => !node.admissionDenials?.length) ? (
                <p className="opacity-80">
                  {i18next.t("node:The node condition is only the symptom — the kubelet log on the node carries the underlying error.")}
                </p>
              ) : null}
            </>
          }
        />
      ) : null}

      {schedulableNodes.length > 0 ? (
        <div className={`grid gap-4 sm:grid-cols-2 ${hasGpus ? "xl:grid-cols-3" : ""}`}>
          <StatCard
            label={i18next.t("node:CPU free")}
            value={formatCores(totals.cpuFreeM)}
            icon={Cpu}
            tone="info"
            hint={i18next.t("node:Unrequested capacity on Ready, schedulable nodes.")}
          />
          <StatCard
            label={i18next.t("node:Memory free")}
            value={formatMiB(totals.memFreeMi)}
            icon={HardDrive}
            tone="info"
            hint={i18next.t("node:Unrequested capacity on Ready, schedulable nodes.")}
          />
          {hasGpus ? (
            <StatCard
              label={i18next.t("node:GPUs free")}
              value={totals.gpuFree}
              suffix={`/ ${totals.gpuAllocatable}`}
              icon={Zap}
              tone={totals.gpuFree > 0 ? "success" : "default"}
              hint={i18next.t("node:Unrequested capacity on Ready, schedulable nodes.")}
            />
          ) : null}
        </div>
      ) : null}

      <DataTable
        testId="nodes-table"
        title={i18next.t("general:Nodes")}
        description={`${nodes?.length ?? 0} nodes`}
        columns={columns}
        dataSource={nodes}
        rowKey="name"
        loading={loading}
        searchable
        emptyText={i18next.t("node:No nodes registered. Add a machine and deploy it as a node from Machines.")}
        toolbar={
          <Button variant="outline" size="sm" onClick={() => refresh()} loading={loading}>
            <RefreshCw />
            {i18next.t("general:Refresh")}
          </Button>
        }
      />

      <FormDialog
        open={labelDialogOpen}
        onOpenChange={setLabelDialogOpen}
        title={`Edit Labels — ${editingNode?.name ?? ""}`}
        submitText={i18next.t("general:Save")}
        submitting={submitting}
        onSubmit={handleLabelSubmit}
      >
        <Field label="Labels" hint="Node labels drive scheduling constraints such as nodeSelector and affinity.">
          <KeyValueEditor value={labelEntries} onChange={setLabelEntries} addLabel="Add Label" />
        </Field>
      </FormDialog>

      <Dialog open={kubeconfigOpen} onOpenChange={setKubeconfigOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Worker Kubeconfig — {kubeconfigNode}</DialogTitle>
            <DialogDescription>
              Save this as <CodeText>/etc/kubernetes/worker.kubeconfig</CodeText> on the worker node, then start kubelet with{" "}
              <CodeText>--kubeconfig=/etc/kubernetes/worker.kubeconfig</CodeText>.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={kubeconfigLoading ? "Loading…" : kubeconfig}
            readOnly
            rows={14}
            className="scrollbar-thin font-mono text-xs"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setKubeconfigOpen(false)}>
              Close
            </Button>
            <Button
              disabled={!kubeconfig}
              onClick={() => {
                navigator.clipboard.writeText(kubeconfig).then(() => Setting.showMessage("success", "Copied to clipboard"));
              }}
            >
              Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

export default NodeListPage;
