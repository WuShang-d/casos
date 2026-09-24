import * as Setting from "../Setting";

const lang = () => ({"Accept-Language": Setting.getAcceptLanguage()});

// With a repository it creates the app; with only a namespace and name it
// rebuilds the latest commit of an app deployed this way.
export function deployGitApp(payload) {
  return fetch(`${Setting.ServerUrl}/api/deploy-git-app`, {
    method: "POST", credentials: "include", headers: {"Content-Type": "application/json", ...lang()}, body: JSON.stringify(payload),
  }).then(r => r.json());
}

export function getGitBuilds(namespace, name) {
  const params = new URLSearchParams({namespace, name});
  return fetch(`${Setting.ServerUrl}/api/get-git-builds?${params}`, {
    credentials: "include", headers: lang(),
  }).then(r => r.json());
}
