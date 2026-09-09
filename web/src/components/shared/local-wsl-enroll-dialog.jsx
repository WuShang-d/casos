import React, {useEffect, useRef} from "react";
import i18next from "i18next";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {MessageAlert} from "@/components/ui/alert";
import {AiDots} from "@/components/shared/loading";

/**
 * Progress of the background enrollment of the local WSL distro. A host without
 * WSL has a distribution to download and register first, which takes minutes,
 * so this shows the server's own progress lines rather than a spinner that says
 * nothing. Closing it does not stop the job.
 */
export function LocalWSLEnrollDialog({open, onOpenChange, status}) {
  const logRef = useRef(null);
  const logs = status?.logs ?? [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs.length]);

  const machine = status?.result?.machine;
  const done = status?.started && !status?.running;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{i18next.t("machine:Add Local WSL")}</DialogTitle>
          <DialogDescription>{i18next.t("machine:Add Local WSL - Progress")}</DialogDescription>
        </DialogHeader>

        {status?.error ? <MessageAlert title={i18next.t("machine:Failed to add local WSL machine")} description={status.error} /> : null}

        {done && !status?.error && machine ? (
          <MessageAlert
            variant="success"
            title={
              status?.result?.created === false
                ? i18next.t("machine:Local WSL machine refreshed")
                : i18next.t("machine:Local WSL machine added")
            }
            description={`${status?.result?.distro || machine.name} (${machine.username}@${machine.ip}:${machine.port})`}
          />
        ) : null}

        <div
          ref={logRef}
          data-testid="local-wsl-logs"
          className="bg-muted/40 scrollbar-thin max-h-72 min-h-24 overflow-auto rounded-lg border p-3"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">{i18next.t("machine:Waiting for the server to report progress")}</p>
          ) : (
            logs.map((line, index) => (
              <div key={index} className="font-mono text-xs leading-6 whitespace-pre-wrap">
                {line}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          {status?.running ? <AiDots size="small" className="mr-auto" /> : null}
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>
            {status?.running ? i18next.t("machine:Continue in background") : i18next.t("general:Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LocalWSLEnrollDialog;
