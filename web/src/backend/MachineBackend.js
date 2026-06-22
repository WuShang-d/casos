import * as Setting from "../Setting";

export function getGlobalMachines() {
  return fetch(`${Setting.ServerUrl}/api/get-global-machines`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => Setting.handleFetchResponse(res));
}

export function getMachine(owner, name) {
  return fetch(`${Setting.ServerUrl}/api/get-machine?id=${owner}/${encodeURIComponent(name)}`, {
    method: "GET",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
  }).then(res => Setting.handleFetchResponse(res));
}

export function updateMachine(owner, name, machine) {
  const newMachine = Setting.deepCopy(machine);
  return fetch(`${Setting.ServerUrl}/api/update-machine?id=${owner}/${encodeURIComponent(name)}`, {
    method: "POST",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
    body: JSON.stringify(newMachine),
  }).then(res => Setting.handleFetchResponse(res));
}

export function addMachine(machine) {
  return fetch(`${Setting.ServerUrl}/api/add-machine`, {
    method: "POST",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
    body: JSON.stringify(machine),
  }).then(res => Setting.handleFetchResponse(res));
}

export function deleteMachine(machine) {
  return fetch(`${Setting.ServerUrl}/api/delete-machine`, {
    method: "POST",
    credentials: "include",
    headers: {"Accept-Language": Setting.getAcceptLanguage()},
    body: JSON.stringify(machine),
  }).then(res => Setting.handleFetchResponse(res));
}
