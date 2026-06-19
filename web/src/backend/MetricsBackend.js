import * as Setting from "../Setting";

export function getMetrics() {
  return fetch(`${Setting.ServerUrl}/api/get-metrics`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => res.json());
}
