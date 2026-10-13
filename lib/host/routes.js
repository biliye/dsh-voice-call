// /api/voice-call/* HTTP 路由（2026-09-15 从 lib/index.js 拆出）
//
// 只构造并返回路由数组，注册与回收由装配层负责（createRoutes 不做任何 ctx 副作用）。
import { API, writeJson, readJsonBody } from './http.js'
import { VOICE_SESSION_ID, ASR_MODE_LOCAL } from './config.js'
// DSH 自己的供应商（设置→模型）：只读，见 dsh-providers.js
import {
  isMissingRoute, resolveDshAsrRequest, resolveDshProviders, resolveDshTtsConfig, transcriptOf,
} from './dsh-providers.js'

export function createRoutes(deps) {
  const { ctx, agents, state, messages, session, speech, bridge, taskApi, localSpeech } = deps
  const { USER_SRC, msg } = messages
  const { ensureVoiceWorld, injectPersona, runEnsure } = session
  const { ttsOnce } = speech
  const { runNode, ASR_OPENAI, ASR_CHAT_AUDIO } = bridge
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
      // 'dsh' = 朗读端用 DSH「设置 → 模型」里的供应商：地址与密钥由 Host 在每次朗读时现取，
      // 浏览器不持有这份密钥。flavor 决定语气标签规则走 MiMo 那套（会演绎）还是严格那套。
      const asked = String(body?.provider || '')
      state.ttsProvider = asked === 'mimo' ? 'mimo' : asked === 'openai' ? 'openai' : asked === 'dsh' ? 'dsh' : 'minimax'
      state.dshFlavor = body?.dshFlavor === 'mimo' ? 'mimo' : 'openai'
      state.directorMode = ['auto', 'fixed'].includes(body?.directorMode) ? body.directorMode : 'off'
      writeJson(res, 200, { ok: true, ttsProvider: state.ttsProvider, dshFlavor: state.dshFlavor, directorMode: state.directorMode })
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
      let cfg = body?.config || {}
      // 朗读端选的是「DSH 供应商」：客户端只报「哪个供应商的哪个模型」，
      // 基地址与凭据由 Host 从 DSH 的设置与凭据库现取（密钥不进浏览器、不进 localStorage）
      if (cfg.provider === 'dsh') {
        const built = await resolveDshTtsConfig(ctx, cfg)
        if (!built.ok) return writeJson(res, 400, { ok: false, error: built.error })
        cfg = { ...cfg, ...built.config }
      }
      const r = await ttsOnce(text, cfg)
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
    // DSH 自己的供应商：设置页两个下拉里那些「DSH · …」选项的列表来源。
    // 只读且只在打开设置页时拉一次——DSH 里改了供应商，重开设置页（或点刷新）就更新，
    // 不需要为此订阅设置变化。
    route(API.dshProviders, async ({ res }) => {
      // 异步版：只写凭据的路由会用 DSH 内置目录里的地址补齐，所以这里能看到它们
      const providers = await resolveDshProviders(ctx)
      writeJson(res, 200, { ok: true, ...providers })
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
      // 云端 OpenAI 兼容路：地址/密钥/模型默认来自客户端设置页；
      // 选了「DSH 供应商」时由 Host 用 DSH 设置里的 baseURL + 凭据库里的 key 覆盖。
      let target = { baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '' }
      let altChat = null
      if (engine === 'dsh-provider' || cfg.mode === 'dsh-provider' || body?.mode === 'dsh-provider') {
        const built = await resolveDshAsrRequest(ctx, cfg)
        if (!built.ok) return writeJson(res, 400, { ok: false, engine: 'dsh-provider', error: built.error })
        target = { baseUrl: built.baseUrl, apiKey: built.apiKey, model: built.model }
        altChat = { baseUrl: built.chatUrl, apiKey: built.apiKey, model: built.model }
      }
      const payload = { audioBase64, mime: body?.mime || 'audio/webm', ext: body?.ext || 'webm', ...target }
      let out = await runNode(ASR_OPENAI, payload)
      let shape = 'transcriptions'
      // DSH 供应商那条路上，/audio/transcriptions 明确不存在（404/405）时改用
      // chat/completions + input_audio——两种都是「OpenAI 兼容」，但端点各家不同。
      // 只在「路由不存在」时换形态：401/403 是凭据问题、400 是参数问题，换形态只会掩盖错因。
      if (altChat && isMissingRoute(out)) {
        out = await runNode(ASR_CHAT_AUDIO, { audioBase64, format: payload.ext === 'wav' ? 'wav' : 'webm', ...altChat })
        shape = 'chat-audio'
      }
      if (!out.ok && out.error) return writeJson(res, 500, { ok: false, error: out.error })
      const text = transcriptOf(out)
      if (text) return writeJson(res, 200, { ok: true, text, shape })
      return writeJson(res, 500, { ok: false, error: `asr: ${out.status} ${String(out.body || '').slice(0, 300)}` })
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
