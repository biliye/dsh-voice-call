// /api/voice-call/* HTTP 路由（2026-09-15 从 lib/index.js 拆出）
//
// 只构造并返回路由数组，注册与回收由装配层负责（createRoutes 不做任何 ctx 副作用）。
import { API, writeJson, readJsonBody } from './http.js'
import { VOICE_SESSION_ID, ASR_MODE_LOCAL } from './config.js'

export function createRoutes(deps) {
  const { ctx, agents, state, messages, session, speech, bridge, taskApi, localSpeech } = deps
  const { USER_SRC, msg } = messages
  const { ensureVoiceWorld, injectPersona, runEnsure } = session
  const { ttsOnce } = speech
  const { runNode, ASR_OPENAI } = bridge
  const { createTask, stopTaskById, taskView } = taskApi
  // ---------- 路由 ----------
  const sameOrigin = (req) => {
    const origin = req.headers?.origin
    if (!origin) return true // 非浏览器客户端（curl/本机工具）无 Origin，放行
    try {
      const o = new URL(origin)
      const host = req.headers?.host
      return !!host && o.host === host
    } catch { return false }
  }
  const route = (path, handler) => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const method = req.method ?? 'GET'
      if ((method === 'POST' || method === 'PUT') && !sameOrigin(req)) {
        return writeJson(res, 403, { ok: false, error: 'forbidden origin' })
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : undefined
      try {
        await handler({ method, query: url, body, res, req })
      } catch (e) {
        writeJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  })

  const routes = [
    route(API.getState, async ({ res }) => {
      if (!state.voiceReady) runEnsure()
      writeJson(res, 200, { ok: true, voiceSessionId: state.voiceSessionId, ready: state.voiceReady, dedicated: true, workspaceId: state.voiceWorkspaceId, workspaceTitle: state.voiceWorkspaceTitle, persona: state.persona, otherDones: state.otherDones.slice(0, 10), tasks: [...state.tasks.values()].map(taskView) })
    }),
    route(API.viewing, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      state.viewingSessionId = body?.sessionId ? String(body.sessionId) : null
      writeJson(res, 200, { ok: true })
    }),
    route(API.ensure, async ({ method, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      try { await ensureVoiceWorld() }
      catch (e) { return writeJson(res, 200, { ok: false, ready: false, error: String(e && e.message || e) }) }
      writeJson(res, 200, { ok: true, ready: true, voiceSessionId: state.voiceSessionId, workspaceId: state.voiceWorkspaceId, workspaceTitle: state.voiceWorkspaceTitle })
    }),
    route(API.bindSession, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      // 语音通话始终绑定专属会话（忽略传入的其他 sessionId）
      if (!state.voiceReady) runEnsure()
      if (state.voiceReady) {
        state.voiceSessionId = VOICE_SESSION_ID
        injectPersona(agents.get(state.voiceSessionId))
      }
      writeJson(res, 200, { ok: true, voiceSessionId: state.voiceSessionId, ready: state.voiceReady, dedicated: true })
    }),
    route(API.setPersona, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      state.persona = String(body?.persona || '').trim()
      injectPersona(state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined)
      writeJson(res, 200, { ok: true })
    }),
    route(API.setAnnounce, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      state.announceOtherDone = body?.enabled !== false
      writeJson(res, 200, { ok: true, announceOtherDone: state.announceOtherDone })
    }),
    // 朗读提供商 / 导演模式同步：只用于让专属会话的提示词与当前朗读方式保持一致。
    // 提示词 section 用函数形式注册，这里改完下一轮组装就生效，不必重启会话。
    route(API.ttsSettings, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      state.ttsProvider = body?.provider === 'mimo' ? 'mimo' : (body?.provider === 'openai' ? 'openai' : 'minimax')
      state.directorMode = ['auto', 'fixed'].includes(body?.directorMode) ? body.directorMode : 'off'
      writeJson(res, 200, { ok: true, ttsProvider: state.ttsProvider, directorMode: state.directorMode })
    }),
    route(API.sendText, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const text = String(body?.text || '').trim()
      if (!text) return writeJson(res, 400, { ok: false, error: 'empty text' })
      const sessionId = body?.sessionId || state.voiceSessionId
      if (!sessionId) return writeJson(res, 400, { ok: false, error: 'voice session not ready' })
      if (sessionId !== state.voiceSessionId) return writeJson(res, 403, { ok: false, error: 'forbidden session' })
      const agent = agents.get(sessionId)
      if (!agent) return writeJson(res, 404, { ok: false, error: `agent not found: ${sessionId}` })
      try { agent.followup(msg(text, USER_SRC)) }
      catch (e) { return writeJson(res, 500, { ok: false, error: String(e && e.message || e) }) }
      writeJson(res, 200, { ok: true })
    }),
    route(API.tts, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const text = String(body?.text || '').trim()
      if (!text) return writeJson(res, 400, { ok: false, error: 'empty text' })
      const r = await ttsOnce(text, body?.config || {})
      writeJson(res, r.ok ? 200 : 500, r)
    }),
    // 本地识别（复用「语音输入」插件的 SenseVoice 模型）：
    // 客户端送来的必须是 16kHz 单声道 PCM16 WAV（VAD 分段路径天然合规）。
    // 模型未就绪时只触发准备并立刻回 202 + needsPrepare，由客户端轮询 asr-status，
    // 就绪后重发同一段音频（下载可能几百秒，不能让一个请求挂在那里）。
    // ?prepare=1 是「唤醒并准备」：会同步等到识别进程起来（上限约 12 秒）再回答，
    // 这样用户点「检查 / 准备模型」能立刻看到确切结果，而不是回一句阶段就没了。
    route(API.asrStatus, async ({ query, res }) => {
      const wantPrepare = query.searchParams.get('prepare') === '1'
      const st = await localSpeech.status({ prepare: wantPrepare })
      writeJson(res, 200, st)
    }),
    route(API.cloudAsr, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const cfg = body?.config || {}
      const audioBase64 = body?.audioBase64 || ''
      const engine = String(cfg.engine || body?.engine || '')
      // 本地模式：模型/推理都在 DSH 宿主里的 speechToText 服务，不走网络桥
      if (engine === 'local' || cfg.mode === ASR_MODE_LOCAL || body?.mode === ASR_MODE_LOCAL) {
        const out = await localSpeech.recognize(audioBase64)
        if (out.ok) return writeJson(res, 200, { ok: true, text: out.text || '', engine: 'local', seconds: out.seconds, inferenceMs: Math.round((out.inferenceSeconds || 0) * 1000) })
        if (out.code === 'needs-prepare') {
          return writeJson(res, 202, { ok: false, needsPrepare: true, phase: out.phase || '', message: out.message || '', error: out.error || '本地模型尚未就绪' })
        }
        return writeJson(res, 500, { ok: false, engine: 'local', code: out.code || '', error: out.error || '本地识别失败' })
      }
      const out = await runNode(ASR_OPENAI, { audioBase64, mime: body?.mime || 'audio/webm', ext: body?.ext || 'webm', baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '' })
      if (!out.ok && out.error) return writeJson(res, 500, { ok: false, error: out.error })
      try {
        const j = JSON.parse(out.body || '{}')
        if (j.text) return writeJson(res, 200, { ok: true, text: j.text })
        return writeJson(res, 500, { ok: false, error: `asr: ${out.status} ${String(out.body || '').slice(0, 300)}` })
      } catch (e) { return writeJson(res, 500, { ok: false, error: `asr parse: ${String(e)}` }) }
    }),
    route(API.tasks, async ({ method, body, res }) => {
      if (method === 'GET') return writeJson(res, 200, { ok: true, tasks: [...state.tasks.values()].map(taskView) })
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const prompt = String(body?.prompt || '').trim()
      if (!prompt) return writeJson(res, 200, { ok: true, tasks: [...state.tasks.values()].map(taskView) })
      const title = String(body?.title || '').trim() || '语音任务'
      const parentSessionId = body?.parentSessionId || state.voiceSessionId
      if (!parentSessionId) return writeJson(res, 400, { ok: false, error: 'voice session not ready' })
      if (parentSessionId !== state.voiceSessionId) return writeJson(res, 403, { ok: false, error: 'forbidden session' })
      const r = await createTask(parentSessionId, title, prompt)
      writeJson(res, r.ok ? 200 : 400, r)
    }),
    route(API.taskStatus, async ({ query, res }) => {
      const t = state.tasks.get(query.searchParams.get('taskId') || '')
      return t ? writeJson(res, 200, { ok: true, task: taskView(t) }) : writeJson(res, 404, { ok: false, error: 'task not found' })
    }),
    route(API.taskStop, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const taskId = String(body?.taskId || '')
      if (!taskId) return writeJson(res, 400, { ok: false, error: 'taskId required' })
      const r = stopTaskById(taskId)
      writeJson(res, r.ok ? 200 : 400, r)
    }),
    route(API.pollEvents, async ({ query, res }) => {
      const since = Number(query.searchParams.get('since')) || 0
      const out = state.events.filter((e) => e.seq > since)
      writeJson(res, 200, { ok: true, events: out.map((e) => ({ ...e })) })
    }),
  ]
  return routes
}
