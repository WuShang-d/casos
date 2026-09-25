import * as Setting from "../Setting";

const post = (path, payload) => fetch(`${Setting.ServerUrl}${path}`, {
  method: "POST",
  credentials: "include",
  headers: {"Content-Type": "application/json", "Accept-Language": Setting.getAcceptLanguage()},
  body: JSON.stringify(payload),
}).then(r => r.json());

export function previewCompose(payload) {
  return post("/api/preview-compose", payload);
}

export function deployCompose(payload) {
  return post("/api/deploy-compose", payload);
}
