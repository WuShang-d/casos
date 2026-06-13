import * as Setting from "../Setting";

export function getServices(namespace = "") {
  return fetch(`${Setting.ServerUrl}/api/get-services?namespace=${encodeURIComponent(namespace)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addService(svc) {
  return fetch(`${Setting.ServerUrl}/api/add-service`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(svc),
  }).then(res => res.json());
}

export function updateService(svc) {
  return fetch(`${Setting.ServerUrl}/api/update-service`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(svc),
  }).then(res => res.json());
}

export function deleteService(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-service`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
