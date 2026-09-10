import React, {useEffect, useState} from "react";
import {useHistory, useParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {Check, Rocket, Search, Store} from "lucide-react";
import * as HelmBackend from "@/backend/HelmBackend";
import * as TemplateBackend from "@/backend/TemplateBackend";
import * as Setting from "@/Setting";
import {useResource} from "@/hooks/use-resource";
import {useUiMode} from "@/hooks/use-ui-mode";
import {ARTIFACT_HUB_SOURCE, DOCKER_HUB_SOURCE, TEMPLATE_SOURCE, useAppCatalog} from "@/hooks/use-app-catalog";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {MessageAlert} from "@/components/ui/alert";
import {Tabs, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {PageContainer, PageHeader} from "@/components/shared/page-header";
import {AppIcon} from "@/components/shared/app-icon";
import {ChartCard} from "@/components/shared/chart-card";
import {Loading} from "@/components/shared/loading";
import {HelmInstallDialog} from "@/components/shared/helm-install-dialog";
import {ImageInstallDialog} from "@/components/shared/image-install-dialog";
import {APP_CATALOG, APP_CATEGORIES} from "@/lib/appCatalog";
import {cn} from "@/lib/utils";

const RECOMMENDED = "recommended";

// The same three catalogues advanced mode lists, named for what they hold
// rather than for the service behind them.
const CATALOG_TABS = [
  {source: TEMPLATE_SOURCE, label: "simple:Ready-made apps", hint: "simple:Complete apps, with the database and web address they need set up in one go."},
  {source: ARTIFACT_HUB_SOURCE, label: "simple:Open-source apps", hint: "simple:Thousands of open-source apps published on ArtifactHub."},
  {source: DOCKER_HUB_SOURCE, label: "simple:Container images", hint: "simple:Type a name to search every image on Docker Hub."},
];

function storePath(key) {
  return key === RECOMMENDED ? "/simple/app-store" : `/simple/app-store/${key}`;
}

function AppCard({app, installed, onInstall}) {
  const {t} = useTranslation();
  return (
    <div className="bg-card hover:border-ring/50 flex h-full flex-col gap-3 rounded-xl border p-4 shadow-sm transition-colors">
      <div className="flex items-start gap-3">
        <AppIcon src={app.icon} chartName={app.chartName} name={app.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{app.name}</span>
            {installed ? (
              <Badge variant="success" className="gap-1">
                <Check className="size-3" />
                {t("simple:Installed")}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{t(app.description)}</p>
        </div>
      </div>
      <Button size="sm" variant={installed ? "outline" : "default"} className="mt-auto self-end" onClick={onInstall}>
        <Rocket />
        {installed ? t("simple:Install again") : t("general:Install")}
      </Button>
    </div>
  );
}

function RecommendedApps({query, installedCharts, onInstall, onBrowseAll}) {
  const {t} = useTranslation();
  const [category, setCategory] = useState("all");

  const needle = query.trim().toLowerCase();
  const visibleApps = APP_CATALOG.filter((app) => {
    if (category !== "all" && app.category !== category) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return app.name.toLowerCase().includes(needle) || t(app.description).toLowerCase().includes(needle);
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {APP_CATEGORIES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setCategory(item.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              category === item.key
                ? "bg-primary text-primary-foreground border-primary font-medium"
                : "hover:bg-accent text-muted-foreground"
            )}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visibleApps.map((app) => (
          <AppCard
            key={app.chartName}
            app={app}
            installed={installedCharts.has(app.chartName)}
            onInstall={() => onInstall({chartName: app.chartName, repoURL: app.repoURL, version: "", displayName: app.name})}
          />
        ))}
      </div>

      {visibleApps.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">{t("simple:No app here matches that.")}</p>
      ) : null}

      <div className="bg-muted/40 flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
        <Store className="text-muted-foreground size-6" />
        <p className="text-sm font-medium">{t("simple:Looking for something else?")}</p>
        <p className="text-muted-foreground max-w-md text-xs">
          {t("simple:Thousands more apps are one tab away — ready-made apps, open-source apps and any container image.")}
        </p>
        <Button variant="outline" size="sm" className="mt-1" onClick={onBrowseAll}>
          {t("simple:Browse all apps")}
        </Button>
      </div>
    </>
  );
}

function CatalogApps({tab, query, onInstallChart, onInstallImage}) {
  const {t} = useTranslation();
  const history = useHistory();
  const {resolvePath} = useUiMode();
  const [category, setCategory] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const {items, kind, loading, error, categories, pagingMore, sentinelRef, reload} = useAppCatalog(tab.source, query, category);

  function syncMarket() {
    setSyncing(true);
    TemplateBackend.syncTemplates()
      .then((res) => {
        if (res.status !== "ok") {
          Setting.showMessage("error", res.msg);
          return;
        }
        reload();
      })
      .catch((e) => Setting.showMessage("error", e.message))
      .finally(() => setSyncing(false));
  }

  function install(chart) {
    if (kind === "template") {
      history.push(resolvePath(`/templates/${chart.chartName}`));
    } else if (kind === "image") {
      onInstallImage(chart.image);
    } else {
      onInstallChart(chart);
    }
  }

  return (
    <>
      <p className="text-muted-foreground -mt-2 text-sm">{t(tab.hint)}</p>

      {kind === "template" && categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {["all", ...categories].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                category === item
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : "hover:bg-accent text-muted-foreground"
              )}
            >
              {item === "all" ? t("general:All") : item}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <MessageAlert title={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((chart, index) => (
          <ChartCard key={`${chart.chartName}-${index}`} chart={chart} onInstall={() => install(chart)} />
        ))}
      </div>

      {loading ? <Loading /> : null}

      {pagingMore ? <div ref={sentinelRef} className="h-px" aria-hidden="true" /> : null}

      {!loading && items.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {kind === "template" && !query
              ? t("template:Update the market to fetch the published templates.")
              : t("simple:No app here matches that.")}
          </p>
          {kind === "template" && !query ? (
            <Button variant="outline" size="sm" loading={syncing} onClick={syncMarket}>
              {t("template:Update market")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Simple mode's App Store. It opens on a short curated list whose apps install
 * with no settings at all, and the full catalogues sit one tab away — simple
 * mode trims the controls, not the choice of apps. Custom repositories and
 * picking an exact chart version are what is left to advanced mode.
 */
function SimpleAppStore() {
  const history = useHistory();
  const {sourceSlug} = useParams();
  const {t} = useTranslation();
  const {switchMode} = useUiMode();
  const [query, setQuery] = useState("");
  const [installTarget, setInstallTarget] = useState(null);
  const [imageTarget, setImageTarget] = useState(null);

  const catalogTab = CATALOG_TABS.find((tab) => tab.source.slug === sourceSlug) ?? null;
  const activeKey = catalogTab ? catalogTab.source.slug : RECOMMENDED;

  // Switching mode keeps the source in the URL, so an advanced-only source (a
  // custom repo, Bitnami) arrives here; it falls back to the curated list.
  useEffect(() => {
    if (sourceSlug && !catalogTab) {
      history.replace(storePath(RECOMMENDED));
    }
  }, [sourceSlug, catalogTab, history]);

  const {data: releases, refresh} = useResource(() => HelmBackend.getHelmReleases(), [], {
    initialData: [],
    toastOnError: false,
  });
  const installedCharts = new Set((releases ?? []).map((release) => release.chartName).filter(Boolean));

  function selectTab(key) {
    setQuery("");
    history.push(storePath(key));
  }

  return (
    <PageContainer>
      <PageHeader
        title={t("general:App Store")}
        description={t("simple:Pick an app and CasOS installs and configures it for you.")}
        actions={
          <Button variant="outline" onClick={() => history.push("/simple/apps")}>
            {t("simple:My Apps")}
          </Button>
        }
      />

      <Tabs value={activeKey} onValueChange={selectTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value={RECOMMENDED}>{t("simple:Recommended")}</TabsTrigger>
          {CATALOG_TABS.map((tab) => (
            <TabsTrigger key={tab.source.slug} value={tab.source.slug}>
              {t(tab.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={catalogTab?.source.kind === "image" ? t("image:Search Docker Hub") : t("general:Search apps")}
          className="pl-9"
        />
      </div>

      {catalogTab ? (
        <CatalogApps
          key={catalogTab.source.slug}
          tab={catalogTab}
          query={query}
          onInstallChart={setInstallTarget}
          onInstallImage={setImageTarget}
        />
      ) : (
        <RecommendedApps
          query={query}
          installedCharts={installedCharts}
          onInstall={setInstallTarget}
          onBrowseAll={() => selectTab(TEMPLATE_SOURCE.slug)}
        />
      )}

      <p className="text-muted-foreground text-center text-xs">
        {t("simple:Adding your own chart repository or picking an exact version is done in advanced mode.")}{" "}
        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => switchMode("advanced")}>
          {t("simple:Advanced mode")}
        </button>
      </p>

      <HelmInstallDialog
        open={Boolean(installTarget)}
        chart={installTarget}
        onClose={() => setInstallTarget(null)}
        onInstalled={() => {
          setInstallTarget(null);
          refresh();
        }}
      />

      <ImageInstallDialog
        open={Boolean(imageTarget)}
        image={imageTarget}
        onClose={() => setImageTarget(null)}
        onInstalled={() => setImageTarget(null)}
      />
    </PageContainer>
  );
}

export default SimpleAppStore;
