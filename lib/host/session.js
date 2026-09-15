// 专属工作区/专属会话：创建、resume 兼容、人格注入、快速回复提示词（2026-09-15 从 lib/index.js 拆出）
//
// 状态写入约定：本模块是 state 里以下字段的唯一写者——
//   voiceSessionId / voiceReady / voiceWorkspaceId / voiceWorkspaceTitle / voiceWorkspaceObj
//   ensuring / ensureTimer / ensureTries / persona / ttsProvider / directorMode
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  ENSURE_MAX_TRIES, ENSURE_RETRY_MS, VOICE_DENY_TOOLS,
  VOICE_QUICK_REPLY_PROMPT_HEAD, VOICE_QUICK_REPLY_PROMPT_TAIL,
  VOICE_SESSION_ID, VOICE_SESSION_TITLE, VOICE_WORKSPACE_DIR, VOICE_WORKSPACE_TITLE,
  toneRuleFor,
} from './config.js'

export function createSession(state, deps) {
  const { ctx, agents, messages } = deps
  const { msg, pluginSrc, pushEvent, sessionEvents, textOf } = messages
  const summarize = (agent, limit = 8) => {
    const evs = sessionEvents(agent)
    const lines = []
    for (let i = evs.length - 1; i >= 0 && lines.length < limit; i--) {
      const e = evs[i]
      if (e.type === 'user/message') lines.unshift(`用户: ${textOf(e.data?.content)}`)
      else if (e.type === 'assistant/message') {
        const t = textOf(e.data?.message?.content)
        if (t) lines.unshift(`助手: ${t}`)
      }
    }
    return lines.join('\n')
  }
  // 人格注入幂等：会话历史里已有相同人格指令时不再重复注入
  const personaInjected = (agent) => {
    const text = `[语音助手人格] ${state.persona}`
    const evs = sessionEvents(agent)
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.type !== 'user/message') continue
      if (textOf(e.data?.content) === text) return true
    }
    return false
  }
  const injectPersona = (agent) => {
    if (!agent || !state.persona) return
    if (personaInjected(agent)) return
    try { agent.inject(msg(`[语音助手人格] ${state.persona}`, pluginSrc('instructions'))) }
    catch (e) { ctx.logger.warn(`voice-call: 人格注入失败: ${String(e && e.message || e)}`) }
  }

  // 解析部署默认模型路由：程序创建的代理必须显式携带 provider/model，
  // 否则 system prompt 里的 {{model}} 变量无值，首轮请求直接失败（任务子代理空结果的根因）。
  const resolveAgentOptions = () => {
    try {
      const sel = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (sel?.provider && sel?.model) {
        const opts = { provider: sel.provider, model: sel.model }
        if (sel.reasoningEffort) opts.reasoningEffort = String(sel.reasoningEffort)
        return opts
      }
    } catch {}
    return undefined
  }

  // ---------- 专属工作区/会话（自动创建，跨重启保持同一会话） ----------
  // 朗读提供商与导演模式：由客户端设置页同步过来（POST /api/voice-call/tts-settings）。
  // 只影响「朗读规则提示词」——真正的朗读行为由每次 /api/voice-call/tts 请求自带的配置决定。
  const voicePromptText = () => [...VOICE_QUICK_REPLY_PROMPT_HEAD, toneRuleFor(state.ttsProvider, state.directorMode), ...VOICE_QUICK_REPLY_PROMPT_TAIL].join('\n')

  // 专属会话的 scoped 世界：快速回复提示词（每次 create/resume 都会重新注册，
  // 因此重启后依然生效）+ 重型工具限制。
  const voiceSetup = (agentCtx) => {
    try {
      agentCtx.systemPrompt.section({
        name: 'voice-call:dedicated',
        order: 60,
        // 用函数形式而不是常量：朗读提供商 / 导演模式是客户端随时可改的设置，
        // 而 systemPrompt 的 text 会在每次组装提示词时求值——这样切换 MiMo / 开关导演模式
        // 后无需重启会话，下一轮就能拿到匹配的朗读规则（否则会把过期的标签规则带进对话）
        text: () => voicePromptText(),
      })
    } catch (e) { ctx.logger.warn(`voice-call: 专属会话提示词注入失败: ${String(e && e.message || e)}`) }
    // 逐个工具名限制：单个工具不存在只跳过该工具，不影响其余限制生效
    for (const toolName of VOICE_DENY_TOOLS) {
      try { agentCtx.tools.restrict({ deny: [toolName] }) }
      catch (e) { ctx.logger.warn(`voice-call: 专属会话工具 ${toolName} 限制跳过: ${String(e && e.message || e)}`) }
    }
  }

  const ensureVoiceWorld = async () => {
    if (state.ensuring) return state.ensuring
    state.ensuring = (async () => {
      // 1. 专属工作区目录（DSH_HOME/voice-call），不存在则创建
      const dir = join(resolveDshHome(), VOICE_WORKSPACE_DIR)
      mkdirSync(dir, { recursive: true })
      const reg = ctx.get('workspaceRegistry')
      if (reg === undefined) throw new Error('workspaceRegistry 服务不可用')
      let ws
      try {
        ws = await reg.create(dir, VOICE_WORKSPACE_TITLE)
      } catch (e) {
        // create 可能对已存在工作区抛错：尝试按 ID/标题/目录查找已注册的工作区
        ctx.logger.warn(`voice-call: 工作区创建失败，尝试查找已存在工作区: ${String(e && e.message || e)}`)
        try {
          const listFn = typeof reg.list === 'function' ? reg.list.bind(reg) : undefined
          const list = listFn ? await listFn() : []
          const rows = Array.isArray(list) ? list : (list?.items || [])
          ws = rows.find((w) => String(w.id) === 'voice-call')
            || rows.find((w) => w.title === VOICE_WORKSPACE_TITLE)
            || rows.find((w) => String(w.dir || w.path || w.root || '').toLowerCase() === dir.toLowerCase())
        } catch (e2) { ctx.logger.warn(`voice-call: 查找已存在工作区失败: ${String(e2 && e2.message || e2)}`) }
        if (!ws) throw e
      }
      state.voiceWorkspaceId = String(ws.id)
      state.voiceWorkspaceTitle = ws.title
      state.voiceWorkspaceObj = ws
      // 2. 专属会话：已存活 → 复用；已持久化 → resume；否则新建
      let agent = agents.get(VOICE_SESSION_ID)
      if (agent === undefined) {
        const persistence = ctx.get('sessionPersistence')
        let persisted = false
        if (persistence !== undefined) {
          try {
            // 会话 id 始终在 snapshot.header.id（SessionPersistenceSnapshot），但“取快照”的方法名
            // 跨 DSH 版本变过：0.1.1 时代 list() 返回扁平 header[]、快照在 listSnapshots()；
            // 0.1.5 起 listSnapshots() 被移除、list() 改为返回快照。这里特性探测方法名，
            // 两条路径读到的都是同一种快照形状（曾写死读 snapshot.id，永远 undefined，
            // 于是重启后总判定“未持久化”走 create，撞 "session already exists"，永远无法 resume）。
            const listSnapshots = typeof persistence.listSnapshots === 'function'
              ? persistence.listSnapshots.bind(persistence)
              : persistence.list.bind(persistence)
            const snapshots = await listSnapshots()
            persisted = snapshots.some((s) => s?.header?.id === VOICE_SESSION_ID)
          } catch (e) {
            // 查询失败不能默认“不存在”，否则可能与已持久化会话冲突；交给重试
            ctx.logger.warn(`voice-call: 会话持久化查询失败: ${String(e && e.message || e)}`)
            throw new Error('sessionPersistence.list 查询失败，稍后重试')
          }
        }
        const agentOptions = resolveAgentOptions()
        if (persisted) {
          const handle = await agents.resume({ resumeSessionId: VOICE_SESSION_ID, ...(agentOptions ? { agentOptions } : {}), setup: voiceSetup })
          agent = handle.agent
        } else {
          const handle = await agents.create({ sessionId: VOICE_SESSION_ID, meta: { cwd: dir }, ...(agentOptions ? { agentOptions } : {}), setup: voiceSetup })
          agent = handle.agent
          // 仅首次创建时固定标题，避免每次启动都往日志写 title 事件
          try { ctx.get('sessionTitle')?.rename(agent.session, VOICE_SESSION_TITLE) } catch (e) { ctx.logger.warn(`voice-call: 会话命名失败: ${String(e && e.message || e)}`) }
          try { agent.inject(msg('[语音通话] 专属会话已就绪：所有语音通话固定保存在本会话（本体重启后依然延续同一会话）；需要执行耗时任务时请使用 voice_task 工具分发给独立子代理会话。', pluginSrc('instructions'))) } catch {}
        }
      }
      if (agent === undefined) throw new Error('专属会话创建失败')
      // 3. 关联到专属工作区（幂等）
      try { await ws.attachSession(VOICE_SESSION_ID) }
      catch (e) { ctx.logger.warn(`voice-call: 工作区关联会话失败: ${String(e && e.message || e)}`) }
      // 4. 绑定完成
      state.voiceSessionId = VOICE_SESSION_ID
      state.voiceReady = true
      state.ensureTries = 0
      if (state.ensureTimer !== null) { const t = state.ensureTimer; state.ensureTimer = null; try { t() } catch {} }
      pushEvent({ kind: 'ready', voiceSessionId: VOICE_SESSION_ID, workspaceId: state.voiceWorkspaceId, workspaceTitle: state.voiceWorkspaceTitle })
      return true
    })()
    try { return await state.ensuring } finally { state.ensuring = null }
  }
  const runEnsure = async () => {
    if (state.voiceReady || state.ensuring) return
    try { await ensureVoiceWorld() }
    catch (e) {
      state.ensureTries += 1
      ctx.logger.warn(`voice-call: 专属工作区/会话初始化失败（第 ${state.ensureTries} 次）: ${String(e && e.message || e)}`)
      if (state.ensureTries >= ENSURE_MAX_TRIES) return
      if (state.ensureTimer === null) state.ensureTimer = ctx.setTimeout(() => { state.ensureTimer = null; runEnsure() }, ENSURE_RETRY_MS)
    }
  }
  return { summarize, personaInjected, injectPersona, resolveAgentOptions, voicePromptText, voiceSetup, ensureVoiceWorld, runEnsure }
}
