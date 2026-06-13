import * as Setting from "../Setting";

export function getNamespaces() {
  return fetch(`${Setting.ServerUrl}/api/get-namespaces`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addNamespace(namespace) {
  return fetch(`${Setting.ServerUrl}/api/add-namespace`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(namespace),
  }).then(res => res.json());
}

export function deleteNamespace(name) {
  return fetch(`${Setting.ServerUrl}/api/delete-namespace`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({name}),
  }).then(res => res.json());
}
