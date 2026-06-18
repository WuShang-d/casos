import * as Setting from "../Setting";

export function getSecrets(namespace = "") {
  return fetch(`${Setting.ServerUrl}/api/get-secrets?namespace=${encodeURIComponent(namespace)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addSecret(secret) {
  return fetch(`${Setting.ServerUrl}/api/add-secret`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(secret),
  }).then(res => res.json());
}

export function updateSecret(secret) {
  return fetch(`${Setting.ServerUrl}/api/update-secret`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(secret),
  }).then(res => res.json());
}

export function deleteSecret(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-secret`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
