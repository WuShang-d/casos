export const HOST_HISTORY_KEY = 'segscope-host-history'
export const validHost = (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 253 && !/[\s/\\]/.test(value.trim())
export function normalizeHosts(value) {
  return Array.isArray(value) ? [...new Set(value.filter(validHost).map((host) => host.trim()))].slice(0, 8) : []
}
export function readHosts(storage) {
  try { return normalizeHosts(JSON.parse(storage.getItem(HOST_HISTORY_KEY) || '[]')) } catch { return [] }
}
export function rememberHost(hosts, host) {
  return validHost(host) ? normalizeHosts([host.trim(), ...hosts]) : hosts
}
