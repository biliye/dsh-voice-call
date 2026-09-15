// HTTP 路由路径表与请求/响应工具（2026-09-15 从 lib/index.js 拆出）
// API 表同时是 host 端路由注册与 client 端调用的唯一路径来源，两边必须一致。

export const API = {
  getState: '/api/voice-call/state',
  bindSession: '/api/voice-call/bind-session',
  ensure: '/api/voice-call/ensure',
  setPersona: '/api/voice-call/persona',
  viewing: '/api/voice-call/viewing',
  setAnnounce: '/api/voice-call/announce',
  ttsSettings: '/api/voice-call/tts-settings',
  sendText: '/api/voice-call/send-text',
  tts: '/api/voice-call/tts',
  cloudAsr: '/api/voice-call/asr',
  tasks: '/api/voice-call/tasks',
  taskStatus: '/api/voice-call/task-status',
  taskStop: '/api/voice-call/task-stop',
  pollEvents: '/api/voice-call/events',
}

export const MAX_JSON_BODY_BYTES = 24 * 1024 * 1024

export function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

export async function readJsonBody(req) {
  const chunks = []
  let size = 0
  let tooBig = false
  for await (const chunk of req) {
    if (tooBig) continue
    const buffer = chunk
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) { tooBig = true; chunks.length = 0; continue }
    chunks.push(buffer)
  }
  if (tooBig) return undefined
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

