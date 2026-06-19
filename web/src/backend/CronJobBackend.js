import * as Setting from "../Setting";

export function getCronJobs(namespace = "") {
  return fetch(`${Setting.ServerUrl}/api/get-cronjobs?namespace=${encodeURIComponent(namespace)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addCronJob(cronjob) {
  return fetch(`${Setting.ServerUrl}/api/add-cronjob`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(cronjob),
  }).then(res => res.json());
}

export function updateCronJob(cronjob) {
  return fetch(`${Setting.ServerUrl}/api/update-cronjob`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(cronjob),
  }).then(res => res.json());
}

export function deleteCronJob(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-cronjob`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
