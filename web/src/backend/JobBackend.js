import * as Setting from "../Setting";

export function getJobs(namespace = "") {
  return fetch(`${Setting.ServerUrl}/api/get-jobs?namespace=${encodeURIComponent(namespace)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}

export function addJob(job) {
  return fetch(`${Setting.ServerUrl}/api/add-job`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(job),
  }).then(res => res.json());
}

export function updateJob(job) {
  return fetch(`${Setting.ServerUrl}/api/update-job`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify(job),
  }).then(res => res.json());
}

export function deleteJob(namespace, name) {
  return fetch(`${Setting.ServerUrl}/api/delete-job`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": Setting.getAcceptLanguage(),
    },
    body: JSON.stringify({namespace, name}),
  }).then(res => res.json());
}
