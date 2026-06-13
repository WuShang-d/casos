import * as Setting from "../Setting";

export function getConfigMaps(namespace = "") {
  return fetch(`${Setting.ServerUrl}/api/get-configmaps?namespace=${encodeURIComponent(namespace)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addConfigMap(configmap) {
  return fetch(`${Setting.ServerUrl}/api/add-configmap`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(configmap),
  }).then(res => res.json());
}

export function updateConfigMap(configmap) {
  return fetch(`${Setting.ServerUrl}/api/update-configmap`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(configmap),
  }).then(res => res.json());
}

export function deleteConfigMap(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-configmap`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
