import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Link, useHistory, useParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {Plus, RefreshCw, Search, Store, Trash2} from "lucide-react";
import * as HelmBackend from "@/backend/HelmBackend";
import * as TemplateBackend from "@/backend/TemplateBackend";
import * as Setting from "@/Setting";
import {runAction} from "@/hooks/use-resource";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {MessageAlert} from "@/components/ui/alert";
import {Separator} from "@/components/ui/separator";
import {SimpleTooltip} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import {ChartCard} from "@/components/shared/chart-card";
import {ConfirmDialog} from "@/components/shared/confirm-dialog";
import {Field, FormDialog} from "@/components/shared/form-dialog";
import {Loading} from "@/components/shared/loading";
import {HelmInstallDialog} from "@/components/shared/helm-install-dialog";
import {ImageInstallDialog} from "@/components/shared/image-install-dialog";
import {ARTIFACT_HUB_SOURCE, DOCKER_HUB_SOURCE, TEMPLATE_SOURCE, useAppCatalog} from "@/hooks/use-app-catalog";
import {useUiMode} from "@/hooks/use-ui-mode";
import SimpleAppStore from "@/pages/simple/SimpleAppStore";

const PRESET_REPOS = [
  {...TEMPLATE_SOURCE, desc: "Ready-made apps, database and domain included"},
  {...ARTIFACT_HUB_SOURCE, desc: "artifacthub.io — 8 000+ charts"},
  {...DOCKER_HUB_SOURCE, desc: "hub.docker.com — any container image"},
  {slug: "bitnami", name: "Bitnami", url: "https://charts.bitnami.com/bitnami", desc: "~200 curated charts"},
  {slug: "rancher", name: "Rancher", url: "https://charts.rancher.io", desc: "Rancher Charts"},
  {slug: "ingress-nginx", name: "ingress-nginx", url: "https://kubernetes.github.io/ingress-nginx", desc: "Official ingress-nginx"},
];

// Each source owns a URL of its own, so a channel can be linked, bookmarked and
// walked back to with the browser's back button. Repo names are unique, which
// makes a slug of the name a stable identity even before the repo list loads.
function repoSlug(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

function sourcePath(slug) {
  return `/app-store/${encodeURIComponent(slug)}`;
}

function AddRepoDialog({open, onClose, onAdded}) {
  const {t} = useTranslation();
  const [form, setForm] = useState({name: "", url: ""});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({name: "", url: ""});
      setErrors({});
    }
  }, [open]);

  async function handleSubmit() {
    const nextErrors = {};
    if (!form.name) {
      nextErrors.name = t("general:required");
    }
    if (!form.url) {
      nextErrors.url = t("general:required");
    } else if (!/^(https?|oci):\/\//.test(form.url)) {
      // OCI registries (e.g. "oci://registry-1.docker.io/casbin/casdoor-helm-charts")
      // host charts just like a classic index.yaml repo, so they are valid here too.
      nextErrors.url = t("helm:Repo URL pattern");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    const ok = await runAction(HelmBackend.addHelmRepo(form), {successMessage: t("helm:Add Helm Repo")});
    setSubmitting(false);
    if (ok) {
      onAdded();
      onClose();
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title={t("helm:Add Helm Repo")}
      submitText={t("general:Add")}
      submitting={submitting}
      onSubmit={handleSubmit}
    >
      <Field label={t("helm:Repo name")} htmlFor="repo-name" required error={errors.name}>
        <Input
          id="repo-name"
          value={form.name}
          onChange={(event) => setForm((prev) => ({...prev, name: event.target.value}))}
          placeholder="my-charts"
        />
      </Field>
      <Field label={t("helm:Repo URL")} htmlFor="repo-url" required error={errors.url}>
        <Input
          id="repo-url"
          value={form.url}
          onChange={(event) => setForm((prev) => ({...prev, url: event.target.value}))}
          placeholder="https://example.com/charts"
        />
      </Field>
    </FormDialog>
  );
}

function AdvancedAppStore() {
  const {t} = useTranslation();
  const history = useHistory();
  const {sourceSlug} = useParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [customRepos, setCustomRepos] = useState([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState(null);
  const [imageTarget, setImageTarget] = useState(null);

  const loadCustomRepos = useCallback(() => {
    HelmBackend.getHelmRepos().then((res) => {
      if (res.status === "ok") {
        setCustomRepos(res.data ?? []);
      }
      setReposLoaded(true);
    });
  }, []);

  useEffect(() => {
    loadCustomRepos();
  }, [loadCustomRepos]);

  const customSources = useMemo(
    () => customRepos.map((repo) => ({...repo, slug: repoSlug(repo.name)})),
    [customRepos]
  );

  // Bare /app-store keeps working as the default channel, so older links and the
  // navigation entry never 404.
  const activeSlug = sourceSlug ? repoSlug(decodeURIComponent(sourceSlug)) : PRESET_REPOS[0].slug;
  const source = useMemo(
    () => PRESET_REPOS.find((repo) => repo.slug === activeSlug) ?? customSources.find((repo) => repo.slug === activeSlug) ?? null,
    [activeSlug, customSources]
  );

  // A slug nothing answers to — a stale bookmark, or the repo the URL points at
  // was just deleted — falls back to the default channel, but only once the
  // custom repos are known, so a direct link to one is not bounced while loading.
  useEffect(() => {
    if (!source && reposLoaded) {
      history.replace(sourcePath(PRESET_REPOS[0].slug));
    }
  }, [source, reposLoaded, history]);

  const {items, kind, loading, error, categories, marketStatus, pagingMore, sentinelRef, reload} = useAppCatalog(source, query, category);
  const isImageSource = kind === "image";
  const isTemplateSource = kind === "template";

  function selectSource(slug) {
    setQuery("");
    setCategory("all");
    history.push(sourcePath(slug));
  }

  function syncMarket() {
    setSyncing(true);
    TemplateBackend.syncTemplates()
      .then((res) => {
        if (res.status !== "ok") {
          Setting.showMessage("error", res.msg);
          return;
        }
        Setting.showMessage("success", t("template:Market updated"));
        reload();
      })
      .catch((e) => Setting.showMessage("error", e.message))
      .finally(() => setSyncing(false));
  }

  function deleteCustomRepo(id) {
    HelmBackend.deleteHelmRepo(id)
      .then((res) => {
        if (res.status !== "ok") {
          Setting.showMessage("error", `${t("helm:Delete repo failed")}: ${res.msg}`);
          return;
        }
        loadCustomRepos();
      })
      .catch((e) => Setting.showMessage("error", `${t("helm:Delete repo failed")}: ${e.message}`));
  }

  function sourceClass(active) {
    return cn(
      "mx-2 flex cursor-pointer items-center rounded-md px-3 py-1.5 text-sm transition-colors",
      active ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50"
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="bg-muted/30 w-52 shrink-0 overflow-y-auto border-r py-4">
        <div className="text-muted-foreground px-4 pb-2 text-[11px] font-semibold tracking-wider uppercase">
          {t("helm:Sources")}
        </div>
        {PRESET_REPOS.map((repo) => (
          <SimpleTooltip key={repo.slug} title={repo.desc} side="right">
            <div onClick={() => selectSource(repo.slug)} className={sourceClass(activeSlug === repo.slug)}>
              {repo.name}
            </div>
          </SimpleTooltip>
        ))}

        {customRepos.length > 0 ? (
          <>
            <Separator className="my-2" />
            <div className="text-muted-foreground px-4 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">
              {t("helm:My Repos")}
            </div>
            {customSources.map((repo) => (
              <div key={repo.id} className={sourceClass(activeSlug === repo.slug)}>
                <span className="flex-1 truncate" onClick={() => selectSource(repo.slug)}>
                  {repo.name}
                </span>
                <ConfirmDialog
                  title={t("helm:Delete repo?")}
                  confirmText={t("general:Delete")}
                  cancelText={t("general:Cancel")}
                  onConfirm={() => deleteCustomRepo(repo.id)}
                >
                  <button
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete repo"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </ConfirmDialog>
              </div>
            ))}
          </>
        ) : null}

        <div className="px-3 pt-3">
          <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setAddRepoOpen(true)}>
            <Plus />
            {t("helm:Add Repo")}
          </Button>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-center gap-3">
          <Store className="size-5" />
          <h1 className="text-lg font-semibold">{source?.name ?? ""}</h1>
          <div className="flex-1" />
          <Button variant="outline" size="sm" asChild>
            {isImageSource ? (
              <Link to="/helm-releases">{t("simple:My Apps")} →</Link>
            ) : (
              <Link to="/helm-releases">{t("helm:My Releases")} →</Link>
            )}
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isTemplateSource
                  ? t("general:Search apps")
                  : isImageSource ? t("image:Search Docker Hub") : t("helm:Search charts")
              }
              className="w-72 pl-9"
            />
          </div>
          <Button variant="outline" loading={loading} disabled={!source} onClick={reload}>
            <RefreshCw />
            {t("general:Refresh")}
          </Button>
          {isTemplateSource ? (
            <Button variant="outline" loading={syncing} onClick={syncMarket}>
              {t("template:Update market")}
            </Button>
          ) : null}
          {isTemplateSource && marketStatus?.updatedAt ? (
            <span className="text-muted-foreground self-center text-xs">
              {t("general:Updated")} {new Date(marketStatus.updatedAt).toLocaleString()} · {marketStatus.count} {t("template:apps")}
            </span>
          ) : null}
        </div>

        {isTemplateSource && categories.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {["all", ...categories].map((item) => (
              <Button
                key={item}
                size="sm"
                variant={category === item ? "default" : "outline"}
                onClick={() => setCategory(item)}
              >
                {item === "all" ? t("general:All") : item}
              </Button>
            ))}
          </div>
        ) : null}

        {error ? <MessageAlert title={error} className="mb-4" /> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((chart, index) => (
            <ChartCard
              key={`${chart.chartName}-${index}`}
              chart={chart}
              onInstall={() => {
                if (isTemplateSource) {
                  history.push(`/templates/${chart.chartName}`);
                  return;
                }
                if (isImageSource) {
                  setImageTarget(chart.image);
                  return;
                }
                setInstallTarget(chart);
              }}
            />
          ))}
        </div>

        {loading || !source ? <Loading /> : null}

        {pagingMore ? <div ref={sentinelRef} className="h-px" aria-hidden="true" /> : null}

        {source && !loading && items.length === 0 && !error ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            {isTemplateSource
              ? t("template:Update the market to fetch the published templates.")
              : isImageSource ? t("image:No images found") : t("helm:No charts found")}
          </p>
        ) : null}
      </div>

      <AddRepoDialog open={addRepoOpen} onClose={() => setAddRepoOpen(false)} onAdded={loadCustomRepos} />

      <HelmInstallDialog
        open={Boolean(installTarget)}
        chart={installTarget}
        onClose={() => setInstallTarget(null)}
        onInstalled={() => setInstallTarget(null)}
      />

      <ImageInstallDialog
        open={Boolean(imageTarget)}
        image={imageTarget}
        onClose={() => setImageTarget(null)}
        onInstalled={() => setImageTarget(null)}
      />
    </div>
  );
}

// Both modes reach the same catalogues. Simple mode leads with a curated
// shortlist and keeps repository management and version fields out of sight;
// advanced mode adds the repository sidebar and custom repos.
export default function AppStorePage() {
  const {advanced} = useUiMode();
  return advanced ? <AdvancedAppStore /> : <SimpleAppStore />;
}
