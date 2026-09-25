import React, {useEffect, useState} from "react";
import i18next from "i18next";
import {Cpu, ExternalLink, HardDrive, Star, TriangleAlert} from "lucide-react";
import * as ComposeBackend from "@/backend/ComposeBackend";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Field, FormDialog} from "@/components/shared/form-dialog";
import {CodeText} from "@/components/shared/misc";
import {runAction} from "@/hooks/use-resource";

const PLACEHOLDER = `services:
  app:
    image: ghost:5
    ports:
      - "2368:2368"
    environment:
      url: http://localhost:2368`;

const emptyForm = () => ({project: "", compose: "", env: ""});

/**
 * Deploys a pasted docker-compose.yml. The first step shows what casos will
 * create, and what it has to leave out, before anything is created.
 */
export function ComposeDeployDialog({open, onOpenChange, onDeployed}) {
  const [form, setForm] = useState(emptyForm);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setPlan(null);
    }
  }, [open]);

  function setField(key, value) {
    setForm((prev) => ({...prev, [key]: value}));
    setPlan(null);
  }

  const payload = () => ({project: form.project.trim(), compose: form.compose, env: form.env});

  async function preview() {
    setBusy(true);
    try {
      await runAction(ComposeBackend.previewCompose(payload()), {
        onSuccess: (res) => setPlan(res.data),
      });
    } finally {
      setBusy(false);
    }
  }

  async function deployNow() {
    setBusy(true);
    try {
      await runAction(ComposeBackend.deployCompose(payload()), {
        successMessage: i18next.t("launchpad:Deployed; the services are starting"),
        onSuccess: (res) => {
          onOpenChange(false);
          onDeployed?.(res.data);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  const footer = plan ? (
    <>
      <Button type="button" variant="outline" onClick={() => setPlan(null)} disabled={busy}>
        {i18next.t("general:Back")}
      </Button>
      <Button type="button" onClick={deployNow} loading={busy} data-testid="compose-deploy">
        {i18next.t("launchpad:Deploy {{count}} services", {count: plan.services.length})}
      </Button>
    </>
  ) : (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        {i18next.t("general:Cancel")}
      </Button>
      <Button type="submit" loading={busy} disabled={!form.compose.trim()} data-testid="compose-preview">
        {i18next.t("launchpad:Preview")}
      </Button>
    </>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={i18next.t("launchpad:Deploy from Compose")}
      description={i18next.t("launchpad:Paste a docker-compose.yml. Each service runs in the project's own namespace and reaches the others by name; one that publishes a port gets an address.")}
      onSubmit={preview}
      size="lg"
      footer={footer}
    >
      {plan ? <ComposePlan plan={plan} /> : (
        <>
          <Field label={i18next.t("launchpad:Project name")} htmlFor="compose-project" hint={i18next.t("launchpad:Names the namespace and the addresses. Leave blank to use the name in the file.")}>
            <Input id="compose-project" value={form.project} onChange={(e) => setField("project", e.target.value)} placeholder="my-blog" autoFocus />
          </Field>
          <Field label="docker-compose.yml" htmlFor="compose-file" required>
            <Textarea
              id="compose-file"
              rows={14}
              className="font-mono text-xs"
              value={form.compose}
              onChange={(e) => setField("compose", e.target.value)}
              placeholder={PLACEHOLDER}
              data-testid="compose-file"
            />
          </Field>
          <Field label=".env" htmlFor="compose-env" hint={i18next.t("launchpad:Values for the ${VAR} references in the file, one NAME=value per line.")}>
            <Textarea
              id="compose-env"
              rows={3}
              className="font-mono text-xs"
              value={form.env}
              onChange={(e) => setField("env", e.target.value)}
              placeholder="DB_PASSWORD=change-me"
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function ComposePlan({plan}) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="compose-plan">
      <p className="text-muted-foreground text-sm">
        {i18next.t("launchpad:These run in the namespace")} <CodeText>{plan.project}</CodeText>.
      </p>
      <ul className="divide-y rounded-md border">
        {plan.services.map((service) => (
          <li key={service.name} className="flex flex-col gap-1 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{service.name}</span>
              {service.main ? (
                <Badge variant="info" title={i18next.t("launchpad:The app the others belong to")}>
                  <Star />
                  {i18next.t("launchpad:Main")}
                </Badge>
              ) : null}
              {service.gpu ? (
                <Badge variant="success">
                  <Cpu />
                  GPU
                </Badge>
              ) : null}
              {service.replicas !== 1 ? <Badge variant="muted">×{service.replicas}</Badge> : null}
              <span className="text-muted-foreground ml-auto truncate font-mono text-xs">{service.image}</span>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {service.url ? (
                <span className="flex items-center gap-1">
                  <ExternalLink className="size-3" />
                  {service.url}
                </span>
              ) : service.ports.length ? (
                <span>{i18next.t("launchpad:Reachable inside the project on {{ports}}", {ports: service.ports.join(", ")})}</span>
              ) : null}
              {service.volumes.map((volume) => (
                <span key={volume} className="flex items-center gap-1">
                  <HardDrive className="size-3" />
                  {volume}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {plan.missingVariables.length ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>{i18next.t("launchpad:These variables are not set and become empty")}</AlertTitle>
          <AlertDescription className="font-mono">{plan.missingVariables.join(", ")}</AlertDescription>
        </Alert>
      ) : null}
      {plan.warnings.length ? (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{i18next.t("launchpad:Left out or changed")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export default ComposeDeployDialog;
