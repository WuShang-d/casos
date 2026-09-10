import React from "react";
import {useTranslation} from "react-i18next";
import {Rocket} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {SimpleTooltip} from "@/components/ui/tooltip";
import {AppIcon} from "@/components/shared/app-icon";

/** One app from a catalogue source, as normalised by `useAppCatalog`. */
export function ChartCard({chart, onInstall}) {
  const {t} = useTranslation();
  return (
    <div data-testid="chart-card" className="bg-card hover:border-ring/50 flex gap-3 rounded-xl border p-3 shadow-sm transition-colors">
      <AppIcon src={chart.icon} chartName={chart.chartName} name={chart.displayName} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <SimpleTooltip title={chart.displayName} className="max-w-xs">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{chart.displayName}</span>
          </SimpleTooltip>
          {chart.version ? <Badge variant="muted">{chart.version}</Badge> : null}
        </div>
        {/* The card only has room for two lines, so the full text lives in a tooltip. */}
        <SimpleTooltip title={chart.description} className="max-w-sm text-left text-wrap">
          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">{chart.description || ""}</p>
        </SimpleTooltip>
        <div className="flex justify-end">
          <Button size="sm" onClick={onInstall}>
            <Rocket />
            {t("general:Install")}
          </Button>
        </div>
      </div>
    </div>
  );
}
