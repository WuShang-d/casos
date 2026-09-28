export const helmTaskStorageSchemaVersion = 2;

const helmTaskStorageMaxAgeMs = 24 * 60 * 60 * 1000;
const helmTaskKeyPrefix = "casos.helmTask.";
const helmTaskStoragePrefix = chartName => `${helmTaskKeyPrefix}${encodeURIComponent(chartName)}.`;

export const helmTaskStorageKey = (chartName, namespace, releaseName) =>
  `${helmTaskStoragePrefix(chartName)}${encodeURIComponent(namespace)}.${encodeURIComponent(releaseName)}`;

export const removeStoredHelmTask = key => {
  if (!key) {return;}
  try {
    window.localStorage.removeItem(key);
  } catch (_) {
    // Storage may be unavailable; task polling still works for this session.
  }
};

export const helmTaskMatchesIdentity = (task, taskId, expectedIdentity) => Boolean(
  task && expectedIdentity &&
  String(task.id) === String(taskId) &&
  (!expectedIdentity.operation || task.operation === expectedIdentity.operation) &&
  task.chartName === expectedIdentity.chartName &&
  task.namespace === expectedIdentity.namespace &&
  task.releaseName === expectedIdentity.releaseName
);

export const helmTaskPollRetryDelay = consecutiveFailures =>
  Math.min(2000 * (2 ** Math.max(consecutiveFailures - 1, 0)), 30000);

const readStoredHelmTask = (key, chartName) => {
  const raw = window.localStorage.getItem(key);
  try {
    const stored = JSON.parse(raw);
    const createdAt = Number(stored?.createdAt);
    const isFresh = createdAt > Date.now() - helmTaskStorageMaxAgeMs;
    const hasTaskIdentity = /^\d+$/.test(String(stored?.taskId ?? "")) &&
      typeof stored?.namespace === "string" && stored.namespace &&
      typeof stored?.releaseName === "string" && stored.releaseName;
    const isCurrentSchema = stored?.schemaVersion === helmTaskStorageSchemaVersion &&
      stored.chartName === chartName &&
      (stored.operation === "install" || stored.operation === "upgrade");
    const isSchemaOneInstallTask = stored?.schemaVersion === 1 && stored.chartName === chartName;
    const isLegacyInstallTask = stored?.schemaVersion === undefined || isSchemaOneInstallTask;
    if (!hasTaskIdentity || (!isCurrentSchema && !isLegacyInstallTask) || !isFresh) {
      return null;
    }
    return {
      key,
      taskId: String(stored.taskId),
      createdAt,
      operation: isCurrentSchema ? stored.operation : "install",
      chartName,
      namespace: stored.namespace,
      releaseName: stored.releaseName,
    };
  } catch (_) {
    return null;
  }
};

export const findStoredHelmTask = (chartName, expectedIdentity = null) => {
  const prefix = helmTaskStoragePrefix(chartName);
  const matches = [];
  const invalidKeys = [];
  try {
    if (expectedIdentity?.namespace && expectedIdentity?.releaseName) {
      const key = helmTaskStorageKey(chartName, expectedIdentity.namespace, expectedIdentity.releaseName);
      const stored = readStoredHelmTask(key, chartName);
      if (!stored) {
        if (window.localStorage.getItem(key) !== null) {removeStoredHelmTask(key);}
        return null;
      }
      return stored.operation === expectedIdentity.operation ? stored : null;
    }
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(prefix)) {continue;}
      const stored = readStoredHelmTask(key, chartName);
      if (stored?.operation === "install") {
        matches.push(stored);
      } else if (!stored) {
        invalidKeys.push(key);
      }
    }
  } catch (_) {
    return null;
  }
  invalidKeys.forEach(removeStoredHelmTask);
  matches.sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
};

// Installs handed to the server and not yet seen to finish, whichever chart they are for.
export const listStoredHelmInstalls = () => {
  const installs = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(helmTaskKeyPrefix)) {continue;}
      let chartName = "";
      try {
        chartName = JSON.parse(window.localStorage.getItem(key))?.chartName ?? "";
      } catch (_) {
        continue;
      }
      const stored = chartName ? readStoredHelmTask(key, chartName) : null;
      if (stored?.operation === "install") {installs.push(stored);}
    }
  } catch (_) {
    return [];
  }
  return installs;
};
