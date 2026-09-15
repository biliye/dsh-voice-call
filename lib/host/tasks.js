// 任务生命周期：分发、巡检、上下文将满时续接、完成/失败/停止结算（2026-09-15 从 lib/index.js 拆出）
//
// 状态写入约定：本模块是 state.taskSeq 与 state.tasks 的唯一写者。
// 任务一律在「语音通话」工作区的独立任务会话中执行，任务会话保留在工作区可供打开查看。
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { VOICE_WORKSPACE_DIR } from './config.js'

export function createTasks(state, deps) {
  const { ctx, agents, messages, session, config } = deps
  const { USER_SRC, msg, pluginSrc, pushEvent, sessionEvents, lastAssistantText } = messages
  const { resolveAgentOptions, summarize } = session
  // ---------- 任务 ----------
  // 任务会话模型：每个任务在「语音通话」工作区下新建一个会话（va-task-*，命名
  // 「语音任务: xxx」）专门执行，完成后保留在工作区可查看；主会话通过 voice_task
  // 或面板查看状态。任务会话工作中由本插件（宿主侧监听进程）定时巡检：
  // 上下文将满时自动新开一个会话续接（携带进度摘要），完成后向主会话汇报成功/失败。
  const PRUNE_KEEP_TASKS = 50
  const TASK_TIMEOUT_MS = Number(config.taskTimeoutMs) || 3600000
  const TASK_POLL_MS = Number(config.taskPollMs) || 15000
  const TASK_ROLLOVER_MAX = Math.max(0, Number(config.taskRolloverMax) || 4)
  const TASK_CONTEXT_LIMIT = Number(config.taskContextLimit) || 0 // 0=自动：模型 contextWindow 的 80%
  const TASK_CONTEXT_FALLBACK = 120000
  const pruneTasks = () => {
    const finished = [...state.tasks.values()].filter((t) => t.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt)
    if (finished.length <= PRUNE_KEEP_TASKS) return
    for (const t of finished.slice(PRUNE_KEEP_TASKS)) state.tasks.delete(t.taskId)
  }
  // 任务会话上下文占用估算（与 compaction 同源的 tokenMeter）
  const measureContext = (agent) => {
    try { return Number(ctx.get('tokenMeter')?.measure?.(agent.session)?.totalTokens) || 0 } catch { return 0 }
  }
  const contextLimitFor = async (agent) => {
    if (TASK_CONTEXT_LIMIT > 0) return TASK_CONTEXT_LIMIT
    try {
      const llm = ctx.get('llm')
      const info = await llm?.resolveModelInfo?.(agent.options.provider, agent.options.model)
      const win = info?.context?.contextWindow
      if (win) return Math.floor(win * 0.8)
    } catch {}
    return TASK_CONTEXT_FALLBACK
  }
  // 在语音通话工作区下新建一个任务会话（createTask 与续接共用）。
  // 会话加入 agent preset（优先继承父会话组合，否则部署默认 standard），
  // 因此具备完整文件/shell/搜索工具；创建后挂到语音通话工作区并命名，保留可查看。
  const createTaskSession = async (parent, title, prompt, opts = {}) => {
    const sessionId = `va-task-${Date.now()}-${state.taskSeq++}`
    // 任务会话是工作区里的普通会话（不能标 origin=subagent/parentSession）：
    // DSH Web 只会把「普通会话」列进工作区会话列表并提供打开/停止/流式查看，
    // 子代理会话须经父会话目录投递，直接创建的子代理在 GUI 中无法完整打开与停止。
    const meta = { cwd: join(resolveDshHome(), VOICE_WORKSPACE_DIR) }
    const presetsSvc = ctx.get('agentPresets')
    let presetId
    if (presetsSvc !== undefined) {
      try { presetId = presetsSvc.composedPreset(parent.ctx) } catch {}
      if (!presetId) { try { presetId = presetsSvc.defaultId } catch {} }
      if (presetId) meta.agentPreset = presetId
    }
    // 任务会话继承主会话的模型路由；主会话无显式路由时用部署默认（否则 {{model}} 无值、首轮即失败）
    const po = parent?.options
    const agentOptions = (po?.provider && po?.model)
      ? { provider: po.provider, model: po.model, ...(po.maxTokens ? { maxTokens: po.maxTokens } : {}) }
      : resolveAgentOptions()
    let handle
    try {
      handle = await agents.create({
        sessionId,
        meta,
        ...(agentOptions ? { agentOptions } : {}),
        setup: async (agentCtx) => {
          if (presetsSvc === undefined) return
          try {
            if (presetsSvc.composeFrom(agentCtx, parent.ctx) !== undefined) return
          } catch (e) { ctx.logger.warn(`voice-call: 任务会话继承 preset 失败: ${String(e && e.message || e)}`) }
          try { await presetsSvc.mount(agentCtx, presetId) }
          catch (e) { ctx.logger.warn(`voice-call: 任务会话挂载默认 preset 失败: ${String(e && e.message || e)}`) }
        },
      })
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    const agent = handle.agent
    try {
      const ap = state.voiceWorkspaceObj?.attachSession?.(sessionId)
      if (ap && typeof ap.catch === 'function') ap.catch((e) => ctx.logger.warn(`voice-call: 任务会话挂到工作区失败: ${String(e && e.message || e)}`))
    } catch (e) { ctx.logger.warn(`voice-call: 任务会话挂到工作区失败: ${String(e && e.message || e)}`) }
    try { ctx.get('sessionTitle')?.rename(agent.session, opts.titleOverride || `语音任务: ${title}`) } catch (e) { ctx.logger.warn(`voice-call: 任务会话命名失败: ${String(e && e.message || e)}`) }
    return { ok: true, sessionId, agent, handle }
  }
  // 取会话里最后一次 turn/end 的 reason：任务完成/中断判定应以此为准，
  // 避免仅凭「idle + 有文本」误判（用户停止/中断也会导致 idle）。
  const lastTurnEndReason = (agent) => {
    const evs = sessionEvents(agent)
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.type === 'turn/end') return e.data?.reason || null
    }
    return null
  }
  const humanizeTurnEnd = (reason) => {
    if (!reason) return '任务被中断'
    if (reason.kind === 'aborted') {
      const cause = reason.reason?.kind
      if (cause === 'user') return '已由用户停止'
      if (cause === 'parent') return '已被上级停止'
      return '任务被中断'
    }
    if (reason.kind === 'error') return `执行出错：${String(reason.error?.message || '模型错误')}`
    if (reason.kind === 'interrupted') return '执行被中断'
    if (reason.kind === 'max-tokens') return '输出超过长度限制被截断'
    if (reason.kind === 'blocked') return '执行被阻塞'
    return `执行结束（${reason.kind}）`
  }
  const failTask = (t, reason) => {
    if (t.status !== 'running') return
    t.status = 'failed'
    t.failReason = String(reason || '未知原因')
    t.updatedAt = Date.now()
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'failed', title: t.title, reason: t.failReason })
    const main = state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined
    if (main) {
      // 必须用 followup（唤醒主会话 → 回复 → reply 事件 → 播报）；inject 只排队不唤醒，
      // 空闲主会话永远不回复，任务结果就不会播报
      const notice = `语音任务「${t.title}」失败：${t.failReason}`
      try { main.followup(msg(notice, pluginSrc('notice', notice))) } catch {}
    }
    pruneTasks()
  }
  const stopTask = (t, reason) => {
    if (!t || t.status !== 'running') return
    const why = String(reason || '用户已停止')
    // 先标记 stopped，避免随后的 idle/turn-end 事件把它误判为完成或失败
    t.status = 'stopped'
    t.failReason = why
    t.updatedAt = Date.now()
    const agent = agents.get(t.sessionId)
    if (agent) { try { agent.cancel?.({ kind: 'user' }) } catch (e) { ctx.logger.warn(`voice-call: 停止任务会话失败: ${String(e && e.message || e)}`) } }
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'stopped', title: t.title, reason: why })
    const main = state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined
    if (main) {
      const notice = `语音任务「${t.title}」已停止：${why}`
      try { main.followup(msg(notice, pluginSrc('notice', notice))) } catch {}
    }
    pruneTasks()
  }
  const stopTaskById = (taskId) => {
    const t = state.tasks.get(String(taskId || ''))
    if (!t) return { ok: false, error: 'task not found' }
    if (t.status !== 'running') return { ok: false, error: `任务不在执行中（${t.status}）`, task: taskView(t) }
    stopTask(t)
    return { ok: true, task: taskView(t) }
  }
  // 上下文将满：新开一个任务会话续接（携带进度摘要），旧会话停止干活但保留可查看
  const rolloverTask = async (t) => {
    const old = agents.get(t.sessionId)
    const progress = t.result || (old ? lastAssistantText(old) : '')
    const summary = old ? summarize(old, 10) : ''
    const handoff = `[任务续接] 你正在继续执行任务「${t.title}」。原任务会话上下文已满，已为你新开一个会话继续。\n\n[已完成进度]\n${summary || progress || '（暂无可见进度）'}\n\n[原始任务]\n${t.prompt}\n\n请继续完成剩余部分，全部完成后用一句话给出最终结果。`
    const parent = state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined
    if (!parent) { failTask(t, '主会话不可用，无法续接'); return }
    const r = await createTaskSession(parent, t.title, handoff, { titleOverride: `语音任务: ${t.title}（续接 ${t.rollovers + 1}）` })
    if (!r.ok) { failTask(t, `上下文已满且续接失败: ${r.error}`); return }
    t.sessions.push(r.sessionId)
    t.sessionId = r.sessionId
    t.rollovers += 1
    t.updatedAt = Date.now()
    try { old?.cancel?.({ kind: 'user' }) } catch (e) { ctx.logger.warn(`voice-call: 续接后停止旧会话失败: ${String(e && e.message || e)}`) }
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'continued', title: t.title, rollovers: t.rollovers, sessionId: r.sessionId })
    try { r.agent.followup(msg(handoff, USER_SRC)) }
    catch (e) { failTask(t, `续接会话发送失败: ${String(e && e.message || e)}`) }
  }
  const createTask = async (parentSessionId, title, prompt) => {
    if (!parentSessionId) return { ok: false, error: '未绑定语音会话，无法创建任务' }
    if (state.voiceSessionId && parentSessionId !== state.voiceSessionId) return { ok: false, error: '仅允许从语音主会话分发任务' }
    const taskId = `task-${Date.now()}-${state.taskSeq++}`
    const parent = agents.get(parentSessionId)
    if (!parent) return { ok: false, error: '主会话不存在' }
    const ctxSummary = summarize(parent, 8)
    const fullPrompt = ctxSummary ? `[来自主语音会话的共享记忆]\n${ctxSummary}\n\n[任务]\n${prompt}` : prompt
    const r = await createTaskSession(parent, title, fullPrompt)
    if (!r.ok) return { ok: false, error: `create agent: ${r.error}` }
    // 先登记再 followup，避免创建后异常导致孤儿会话
    const t = { taskId, title, prompt, status: 'running', result: '', failReason: '', sessionId: r.sessionId, sessions: [r.sessionId], rollovers: 0, createdAt: Date.now(), updatedAt: Date.now() }
    state.tasks.set(taskId, t)
    try { r.agent.followup(msg(fullPrompt, USER_SRC)) }
    catch (e) {
      failTask(t, '任务发送失败')
      return { ok: false, error: `followup: ${String(e && e.message || e)}` }
    }
    pushEvent({ kind: 'task', taskId, status: 'running', title, sessionId: r.sessionId })
    return { ok: true, taskId, sessionId: r.sessionId }
  }
  const completeTask = (t, agent) => {
    if (t.status !== 'running') return
    const text = lastAssistantText(agent)
    t.status = 'completed'
    t.result = text
    t.updatedAt = Date.now()
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'completed', result: text.slice(0, 600), title: t.title })
    const main = state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined
    if (main) {
      // 同上：followup 唤醒主会话，让"任务已完成（成功）"真正播报出来
      // 只给主会话喂"截断后的结果 + 明确转述指令"，避免长结果被原文复述、浪费 token
      const brief = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300) || '(无文本结果)'
      const notice = `语音任务「${t.title}」已完成（成功）：\n${brief}\n\n请用一句话向用户转述核心结果，不要逐条复述原文。`
      // 折叠行摘要只放结论，不重复正文里的转述指令
      try { main.followup(msg(notice, pluginSrc('notice', `语音任务「${t.title}」已完成（成功）`))) } catch {}
    }
    pruneTasks()
  }
  const taskView = (t) => ({ taskId: t.taskId, title: t.title, status: t.status, result: t.result.slice(0, 500), failReason: t.failReason, sessionId: t.sessionId, sessions: t.sessions, rollovers: t.rollovers, createdAt: t.createdAt, updatedAt: t.updatedAt })
  return {
    PRUNE_KEEP_TASKS, TASK_TIMEOUT_MS, TASK_POLL_MS, TASK_ROLLOVER_MAX, TASK_CONTEXT_LIMIT, TASK_CONTEXT_FALLBACK,
    pruneTasks, measureContext, contextLimitFor, createTaskSession, lastTurnEndReason, humanizeTurnEnd,
    failTask, stopTask, stopTaskById, rolloverTask, createTask, completeTask, taskView,
  }
}
