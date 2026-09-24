import * as Setting from "../Setting";

export function getAiModels() {
  return fetch(`${Setting.ServerUrl}/api/get-ai-models`, {
    credentials: "include", headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(r => r.json());
}
