import React, {useEffect, useState} from "react";
import i18next from "i18next";
import {Cloud, ExternalLink, LogOut, Unplug} from "lucide-react";
import * as MeshBackend from "@/backend/MeshBackend";
import {runAction} from "@/hooks/use-resource";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {ConfirmDialog} from "@/components/shared/confirm-dialog";
import {CodeText} from "@/components/shared/misc";

const STATUS_POLL_INTERVAL = 5000;
const RESTART_RELOAD_DELAY = 8000;

/**
 * What a member machine shows instead of the console: it runs no cluster of
 * its own, so all there is to see is which cloud it belongs to and whether it
 * is connected, with the way to that cloud's console and the way out.
 */
function MemberPage({initialStatus, onSignout}) {
  const [status, setStatus] = useState(initialStatus);
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      MeshBackend.getMeshStatus()
        .then((res) => res.status === "ok" && setStatus(res.data))
        .catch(() => {});
    }, STATUS_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  async function leave(force) {
    setLeaving(true);
    const ok = await runAction(MeshBackend.leaveMesh(force), {
      successMessage: i18next.t("machine:CasOS is restarting"),
      onError: () => setLeaveFailed(true),
    });
    if (ok) {
      setTimeout(() => window.location.replace("/"), RESTART_RELOAD_DELAY);
      return;
    }
    setLeaving(false);
  }

  return (
    <div className="bg-muted/30 flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-xl" data-testid="member-page">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="text-muted-foreground size-5" />
            {i18next.t("machine:This computer is part of a cloud")}
          </CardTitle>
          <CardDescription>{i18next.t("machine:Member - Description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{i18next.t("machine:Connection status")}</span>
            {status?.connected ? (
              <Badge variant="success">{i18next.t("machine:Connected")}</Badge>
            ) : (
              <Badge variant="warning">{i18next.t("machine:Reconnecting")}</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{i18next.t("machine:Cloud address")}</span>
            <CodeText>{status?.hubUrl}</CodeText>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{i18next.t("machine:Name in the cloud")}</span>
            <CodeText>{status?.machine}</CodeText>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSignout}>
            <LogOut />
            {i18next.t("account:Sign Out")}
          </Button>
          <div className="flex gap-2">
            <ConfirmDialog
              title={i18next.t("machine:Leave the cloud?")}
              description={i18next.t("machine:Leave - Description")}
              confirmText={i18next.t("machine:Leave")}
              cancelText={i18next.t("general:Cancel")}
              onConfirm={() => leave(leaveFailed)}
            >
              <Button variant="outline" size="sm" loading={leaving}>
                <Unplug />
                {leaveFailed ? i18next.t("machine:Leave anyway") : i18next.t("machine:Leave")}
              </Button>
            </ConfirmDialog>
            {status?.consoleUrl ? (
              <Button size="sm" asChild>
                <a href={status.consoleUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {i18next.t("machine:Open the cloud console")}
                </a>
              </Button>
            ) : null}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

export default MemberPage;
