const DEFAULT_PORT = 18792
const DEFAULT_AUTO_CONNECT = true

function normalizeBool(value, fallback) {
  if (value === true) return true
  if (value === false) return false
  return fallback
}

function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_PORT
  if (n <= 0 || n > 65535) return DEFAULT_PORT
  return n
}

function updateRelayUrl(port) {
  const el = document.getElementById('relay-url')
  if (!el) return
  el.textContent = `http://127.0.0.1:${port}/`
}

function setStatus(kind, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.dataset.kind = kind || ''
  status.textContent = message || ''
}

async function checkRelayReachable(port) {
  const url = `http://127.0.0.1:${port}/`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setStatus('ok', `Relay reachable at ${url}`)
  } catch {
    setStatus(
      'error',
      `Relay not reachable at ${url}. Start a local browser relay server on this machine, then click the toolbar button again.`,
    )
  } finally {
    clearTimeout(t)
  }
}

async function load() {
  const stored = await chrome.storage.local.get(['relayPort', 'autoConnect'])
  const port = clampPort(stored.relayPort)
  document.getElementById('port').value = String(port)
  updateRelayUrl(port)
  const autoConnect = normalizeBool(stored.autoConnect, DEFAULT_AUTO_CONNECT)
  document.getElementById('auto-connect').checked = autoConnect
  await checkRelayReachable(port)
}

async function save() {
  const input = document.getElementById('port')
  const port = clampPort(input.value)
  await chrome.storage.local.set({ relayPort: port })
  input.value = String(port)
  updateRelayUrl(port)
  await checkRelayReachable(port)
}

async function saveAutoConnect() {
  const el = document.getElementById('auto-connect')
  const autoConnect = normalizeBool(el.checked, DEFAULT_AUTO_CONNECT)
  await chrome.storage.local.set({ autoConnect })
}

document.getElementById('save').addEventListener('click', () => void save())
document.getElementById('auto-connect').addEventListener('change', () => void saveAutoConnect())
void load()
