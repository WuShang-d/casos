import {useCallback, useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import * as HelmBackend from "@/backend/HelmBackend";
import * as PodBackend from "@/backend/PodBackend";
import * as TemplateBackend from "@/backend/TemplateBackend";
import {IMAGE_STARTER_APPS} from "@/lib/imageCatalog";

// A source is a place apps come from, and there are three kinds of them: a Helm
// repository (or ArtifactHub's search over all of them), Docker Hub's plain
// container images, and the template market — whole applications, database and
// domain included, published for the sealos store and deployed here unchanged.
// They install differently; a reader browsing for something to run should not
// have to care, which is why they are one store rather than three.
//
// Both modes browse the same three catalogues. What advanced mode adds is
// control over where charts come from — its own repositories — not more apps.
export const TEMPLATE_SOURCE = {slug: "templates", name: "Templates", url: null, kind: "template"};
export const ARTIFACT_HUB_SOURCE = {slug: "artifacthub", name: "ArtifactHub", url: null};
export const DOCKER_HUB_SOURCE = {slug: "dockerhub", name: "Docker Hub", url: null, kind: "image"};

const ARTIFACT_HUB_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE = 350;

// ArtifactHub is a search API with server-side paging; a plain repo returns its
// whole index at once and is filtered in the browser.
export function catalogKind(source) {
  if (!source) {
    return null;
  }
  if (source.kind === "template" || source.kind === "image") {
    return source.kind;
  }
  return source.url ? "repo" : "artifacthub";
}

function formatPullCount(count) {
  if (!count) {
    return "";
  }
  if (count >= 1e9) {
    return `${(count / 1e9).toFixed(1)}B`;
  }
  if (count >= 1e6) {
    return `${(count / 1e6).toFixed(0)}M`;
  }
  if (count >= 1e3) {
    return `${(count / 1e3).toFixed(0)}K`;
  }
  return String(count);
}

/**
 * Lists one source's apps as cards. `source` must be a stable object — a
 * module constant or a memoised one — since a new identity refetches.
 */
export function useAppCatalog(source, query, category) {
  const {t} = useTranslation();
  const kind = catalogKind(source);
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [categories, setCategories] = useState([]);
  const [marketStatus, setMarketStatus] = useState(null);
  const sentinelRef = useRef(null);

  const fetchCharts = useCallback((activeSource, activeQuery, activePage, activeCategory) => {
    setLoading(true);
    setError(null);

    // The market is searched and filtered where it is stored, so a category is
    // a request rather than a filter over a list the browser is holding.
    if (activeSource.kind === "template") {
      TemplateBackend.getTemplates({search: activeQuery, category: activeCategory})
        .then((res) => {
          if (res.status !== "ok") {
            setError(res.msg);
            return;
          }
          setCharts(res.data?.templates ?? []);
          setCategories(res.data?.categories ?? []);
          setMarketStatus(res.data?.status ?? null);
          setHasMore(false);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }

    // Docker Hub has no browsable index — a bare search ranks base images and CI
    // artefacts above anything anyone would install — so an empty query shows a
    // shortlist of known apps and typing hands over to Hub's own search.
    if (activeSource.kind === "image") {
      if (!activeQuery.trim()) {
        setCharts(IMAGE_STARTER_APPS);
        setHasMore(false);
        setLoading(false);
        return;
      }
      PodBackend.searchDockerHubImages(activeQuery)
        .then((res) => {
          if (res.status !== "ok") {
            setError(res.msg);
            return;
          }
          setCharts(res.data ?? []);
          setHasMore(false);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }

    const remote = !activeSource.url;
    const request = remote
      ? HelmBackend.searchArtifactHub(activeQuery, activePage)
      : HelmBackend.getRepoCharts(activeSource.url);

    request
      .then((res) => {
        if (res.status !== "ok") {
          setError(res.msg);
          return;
        }
        const data = res.data ?? [];
        if (remote) {
          setCharts((previous) => (activePage === 1 ? data : [...previous, ...data]));
          setHasMore(data.length === ARTIFACT_HUB_PAGE_SIZE);
        } else {
          setCharts(data);
          setHasMore(false);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!source) {
      return;
    }
    setCharts([]);
    setPage(1);
    setHasMore(true);
    // Both remote channels search per keystroke; a short pause keeps a typed
    // word from spending one request per letter against a rate-limited API.
    const timer = setTimeout(() => fetchCharts(source, query, 1, category), query ? SEARCH_DEBOUNCE : 0);
    return () => clearTimeout(timer);
  }, [source, query, category, fetchCharts]);

  useEffect(() => {
    if (source && page > 1) {
      fetchCharts(source, query, page, category);
    }
  }, [page, fetchCharts, source, query, category]);

  const pagingMore = kind === "artifacthub" && hasMore;

  // Infinite scroll: the sentinel sits below the grid, so the next ArtifactHub
  // page is requested as soon as it scrolls close to the viewport. Re-running
  // once "loading" flips back to false re-arms the observer, which also keeps
  // paging when a short page does not fill the screen.
  useEffect(() => {
    if (!pagingMore || loading) {
      return;
    }
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          setPage((previous) => previous + 1);
        }
      },
      {rootMargin: "400px"}
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pagingMore, loading, charts.length]);

  const reload = useCallback(() => {
    if (!source) {
      return;
    }
    setCharts([]);
    setPage(1);
    fetchCharts(source, query, 1, category);
  }, [source, query, category, fetchCharts]);

  // ArtifactHub and a plain Helm index describe a chart with different field
  // names; normalising here keeps the card and the install dialog from each
  // having to know which source they came from.
  function normalize(chart) {
    if (kind === "template") {
      return {
        chartName: chart.name,
        displayName: chart.title || chart.name,
        description: chart.description,
        version: (chart.categories ?? [])[0] ?? "",
        icon: chart.icon ?? null,
        template: chart,
      };
    }
    if (kind === "image") {
      // A starter entry names its image and describes itself with a translation
      // key; a Hub search result carries the description its publisher wrote.
      const starter = Boolean(chart.image);
      return {
        image: starter ? chart.image : chart.name,
        chartName: starter ? chart.image : chart.name,
        displayName: chart.name,
        description: starter ? t(chart.description) : chart.description,
        version: chart.isOfficial ? t("image:Official") : formatPullCount(chart.pullCount),
        icon: chart.logoUrl ?? null,
      };
    }
    if (kind === "artifacthub") {
      return {
        chartName: chart.name,
        repoURL: chart.repository?.url ?? "",
        artifactHubRepository: chart.repository?.name ?? "",
        version: chart.version ?? "",
        displayName: chart.display_name || chart.name,
        description: chart.description,
        icon: chart.logo_image_id ? `https://artifacthub.io/image/${chart.logo_image_id}` : chart.logo_url ?? null,
      };
    }
    return {
      chartName: chart.name,
      repoURL: source?.url ?? "",
      version: chart.version ?? "",
      displayName: chart.name,
      description: chart.description,
      icon: chart.icon,
    };
  }

  const items = (kind === "repo"
    ? charts.filter((chart) => {
      const needle = query.toLowerCase();
      return (
        !needle ||
          (chart.name || "").toLowerCase().includes(needle) ||
          (chart.description || "").toLowerCase().includes(needle)
      );
    })
    : charts
  ).map(normalize);

  return {items, kind, loading, error, categories, marketStatus, pagingMore, sentinelRef, reload};
}
