export const HOST_HISTORY_KEY = 'thermalscope-host-history'

export const validHost = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= 253 &&
  !/[\s/\\]/.test(value.trim())

export function normalizeHosts(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const raw of value) {
    if (!validHost(raw)) continue
    const host = raw.trim()
    if (seen.has(host)) continue
    seen.add(host)
    result.push(host)
    if (result.length >= 8) break
  }
  return result
}

export function readHosts(storage) {
  try {
    return normalizeHosts(JSON.parse(storage.getItem(HOST_HISTORY_KEY) || '[]'))
  } catch {
    return []
  }
}

export function rememberHost(hosts, host) {
  if (!validHost(host)) return hosts
  return normalizeHosts([host.trim(), ...hosts])
}

export function removeHost(hosts, host) {
  return hosts.filter((value) => value !== host)
}
