import * as Setting from "../Setting";

export function getRoleBindings(namespace = "") {
  const ns = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
  return fetch(`${Setting.ServerUrl}/api/get-rolebindings${ns}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addRoleBinding(rb) {
  return fetch(`${Setting.ServerUrl}/api/add-rolebinding`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(rb),
  }).then(res => res.json());
}

export function updateRoleBinding(rb) {
  return fetch(`${Setting.ServerUrl}/api/update-rolebinding`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(rb),
  }).then(res => res.json());
}

export function deleteRoleBinding(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-rolebinding`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
