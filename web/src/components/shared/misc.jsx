import * as React from "react";
import i18next from "i18next";
import {Check, Copy, Eye, EyeOff, HelpCircle} from "lucide-react";
import * as Setting from "@/Setting";
import {cn} from "@/lib/utils";
import {Button} from "@/components/ui/button";
import {SimpleTooltip} from "@/components/ui/tooltip";

/** Label followed by a question mark that explains it — the old Setting.getLabel. */
export function LabelWithTip({text, tooltip, className}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span>{text}</span>
      <SimpleTooltip title={tooltip}>
        <HelpCircle className="text-muted-foreground size-3.5 cursor-help" />
      </SimpleTooltip>
    </span>
  );
}

/** Copies text to the clipboard and confirms it in place for a moment. */
export function CopyButton({value, className, size = "icon-xs", label = "Copy"}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value ?? ""));
      setCopied(true);
    } catch {
      // Clipboard access is denied in some embedded contexts; failing quietly
      // is better than a toast the reader cannot act on.
    }
  }

  return (
    <SimpleTooltip title={copied ? "Copied" : label}>
      <Button type="button" variant="ghost" size={size} className={className} onClick={handleCopy} aria-label={label}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </SimpleTooltip>
  );
}

/** Monospace value with a copy affordance — image refs, tokens, cluster IPs. */
export function CodeText({children, className, copyable = false}) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      <code className="bg-muted truncate rounded px-1.5 py-0.5 font-mono text-xs">{children}</code>
      {copyable ? <CopyButton value={children} /> : null}
    </span>
  );
}

/** Scrollable pre block for YAML, logs and command output. */
export function CodeBlock({children, className, maxHeight = "24rem", copyable = false}) {
  return (
    <div className={cn("bg-muted/60 relative overflow-hidden rounded-lg border", className)}>
      {copyable ? <CopyButton value={children} className="absolute top-1.5 right-1.5 z-10" /> : null}
      <pre className="scrollbar-thin overflow-auto p-3 font-mono text-xs leading-relaxed" style={{maxHeight}}>
        {children}
      </pre>
    </div>
  );
}

/** Key/value rows — the antd Descriptions replacement. */
export function DescriptionList({items, columns = 1, className}) {
  return (
    <dl
      className={cn("grid gap-x-6 gap-y-3 text-sm", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3", className)}
    >
      {(items ?? [])
        .filter(Boolean)
        .map((item, index) => (
          <div key={item.key ?? index} className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">{item.label}</dt>
            <dd className="break-words">{item.value ?? "—"}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Full-page status screen — 404s and permission errors. */
export function ResultScreen({status = "404", title, subTitle, extra, className}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-24 text-center", className)}>
      <p className="text-muted-foreground/60 text-6xl font-semibold tracking-tight">{status}</p>
      <h2 className="text-lg font-semibold">{title}</h2>
      {subTitle ? <p className="text-muted-foreground max-w-md text-sm">{subTitle}</p> : null}
      {extra ? <div className="mt-2">{extra}</div> : null}
    </div>
  );
}

/** Horizontal group with consistent spacing — the antd Space replacement. */
export function Space({children, className, size = "default", direction = "horizontal", wrap = false, align}) {
  const gap = {small: "gap-1.5", default: "gap-2", middle: "gap-2", large: "gap-4"}[size] ?? "gap-2";
  return (
    <div
      className={cn(
        "flex",
        direction === "vertical" ? "flex-col items-stretch" : "items-center",
        wrap && "flex-wrap",
        align === "start" && "items-start",
        align === "end" && "items-end",
        gap,
        className
      )}
    >
      {children}
    </div>
  );
}

export function CopyField({label, value, secret}) {
  const [revealed, setRevealed] = React.useState(false);
  if (!value) {
    return null;
  }
  const shown = secret && !revealed ? "•".repeat(Math.min(String(value).length, 24)) : value;

  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-1.5">
        <code className="bg-muted/60 min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-xs">{shown}</code>
        {secret ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={revealed ? i18next.t("database:Hide") : i18next.t("database:Reveal")}
            onClick={() => setRevealed((open) => !open)}
          >
            {revealed ? <EyeOff /> : <Eye />}
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={i18next.t("launchpad:Copy")}
          onClick={() => {
            navigator.clipboard?.writeText(String(value));
            Setting.showMessage("success", i18next.t("launchpad:Copied"));
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}
