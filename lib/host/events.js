// 会话事件订阅、任务巡检与后台 job 监听（2026-09-15 从 lib/index.js 拆出）
//
// 这里是插件对外部事件的唯一入口：订阅、巡检、jobs 监听都在 installEvents() 内注册，
// 由装配层在 apply() 期间调用，保证副作用挂在插件 fiber 上、停用时可回收。
import { stripMetaLines } from './config.js'

export function installEvents(deps) {
  const { ctx, agents, state, messages, session, taskApi, announce } = deps
  const { pushEvent, textOf, sessionEvents, lastAssistantText } = messages
  const { runEnsure } = session
  const {
    TASK_POLL_MS, TASK_TIMEOUT_MS, TASK_ROLLOVER_MAX, completeTask, failTask, stopTask, humanizeTurnEnd,
    lastTurnEndReason, rolloverTask, measureContext, contextLimitFor,
  } = taskApi
  const { shouldAnnounceOther, resolveTitle, flushReports, recordOtherDone } = announce
  // ---------- 会话事件：主会话助手回复 → 语音事件队列（供面板显示与 TTS） ----------
  // 回复先剔除 Route/流程等元信息行（stripMetaLines），否则会被整句朗读出来
  ctx.on('session/event', (session, event) => {
    if (state.voiceSessionId && session.id === state.voiceSessionId && event.type === 'assistant/message') {
      const t = stripMetaLines(textOf(event.data?.message?.content))
      if (t) pushEvent({ kind: 'reply', text: t })
    }
    for (const task of state.tasks.values()) {
      if (task.sessionId !== session.id) continue
      // 任何事件都刷新活跃时间（用于"长时间无进展"失败判定）
      if (task.status === 'running') task.updatedAt = Date.now()
      if (event.type === 'assistant/message') {
        const t = textOf(event.data?.message?.content)
        if (t && t !== task.result) { task.result = t; pushEvent({ kind: 'task', taskId: task.taskId, status: 'running', progress: t.slice(0, 300), title: task.title }) }
      }
    }
  })
  ctx.on('agent/status', (payload) => {
    const { agent, status } = payload
    if (!agent) return
    const agentId = agent?.session?.id || agent?.id
    if (status === 'running') {
      state.wasRunningOther.add(agentId)
      return
    }
    if (status !== 'idle') return
    // 主会话刚完成一轮回复：立即冲刷待播报队列（合并成一条 steer 进主会话）
    if (agentId === state.voiceSessionId) { state.wasRunningOther.delete(agentId); flushReports(); return }
    for (const task of state.tasks.values()) {
      // 只认当前活动会话（续接后旧会话 idle 不结算任务）
      if (task.sessionId !== agentId) continue
      if (task.status !== 'running') break
      // 以最后一次 turn/end 的 reason 判定完成/中断/停止，不能仅凭 idle+文本
      const reason = lastTurnEndReason(agent)
      if (reason && reason.kind === 'completed') { completeTask(task, agent); break }
      if (reason) {
        if (reason.kind === 'aborted' && reason.reason?.kind === 'user') stopTask(task, humanizeTurnEnd(reason))
        else failTask(task, humanizeTurnEnd(reason))
        break
      }
      if (lastAssistantText(agent)) completeTask(task, agent)
      break
    }
    // 其他会话任务完成：只有观察到 running→idle 且出现新助手回复才记录，
    // 避免宿主重启后把旧会话的最后一条回复重复播报
    if (!state.wasRunningOther.has(agentId)) return
    state.wasRunningOther.delete(agentId)
    try {
      const header = agent.session?.header
      if (!header || header.origin === 'subagent' || String(agentId).startsWith('va-task-')) return
      if (!shouldAnnounceOther(agentId)) return
      const evs = sessionEvents(agent)
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i]
        if (e.type === 'assistant/message') {
          const t = textOf(e.data?.message?.content)
          if (t && (state.otherDoneSeq.get(agentId) ?? 0) < (e.seq ?? 0)) {
            state.otherDoneSeq.set(agentId, e.seq ?? 0)
            recordOtherDone(agentId, t, resolveTitle(agent))
          }
          break
        }
      }
    } catch (e) { ctx.logger.warn(`voice-call: 其他会话完成跟踪失败: ${String(e && e.message || e)}`) }
  })
  // 监听进程：任务会话工作时定时巡检——完成/失败判定 + 上下文将满时续接新会话。
  const checkMs = TASK_POLL_MS
  ctx.interval(async () => {
    // 专属会话被删除/卸载时自动重建
    if (state.voiceSessionId && agents.get(state.voiceSessionId) === undefined) {
      state.voiceSessionId = null
      state.voiceReady = false
      runEnsure()
    }
    for (const task of state.tasks.values()) {
      if (task.status !== 'running') continue
      const agent = agents.get(task.sessionId)
      if (!agent) { failTask(task, '任务会话不存在或已销毁'); continue }
      const t = lastAssistantText(agent)
      if (t && t !== task.result) { task.result = t; task.updatedAt = Date.now(); pushEvent({ kind: 'task', taskId: task.taskId, status: 'running', progress: t.slice(0, 300), title: task.title }) }
      if (agent.status === 'idle') {
        const reason = lastTurnEndReason(agent)
        // 以最后一次 turn/end reason 结算：completed → 完成；aborted/interrupted/error → 停止/失败
        if (reason && reason.kind === 'completed') { completeTask(task, agent); continue }
        if (reason) {
          if (reason.kind === 'aborted' && reason.reason?.kind === 'user') stopTask(task, humanizeTurnEnd(reason))
          else failTask(task, humanizeTurnEnd(reason))
          continue
        }
        if (t) { completeTask(task, agent); continue }
        if (Date.now() - task.updatedAt > TASK_TIMEOUT_MS) { failTask(task, '超时无结果'); continue }
        continue
      }
      // 仍在工作中：检查上下文是否将满，满了且尚未超过续接上限 → 新开一个会话续接
      if (agent.status === 'running' && Date.now() - task.updatedAt > TASK_TIMEOUT_MS) { failTask(task, '执行超时（长时间无进展）'); continue }
      if (agent.status === 'running' && task.rollovers < TASK_ROLLOVER_MAX && (t || sessionEvents(agent).length > 2)) {
        try {
          const usage = measureContext(agent)
          const limit = await contextLimitFor(agent)
          if (limit > 0 && usage >= limit) await rolloverTask(task)
        } catch (e) { ctx.logger.warn(`voice-call: 任务上下文检查失败: ${String(e && e.message || e)}`) }
      }
    }
  }, checkMs)

  // 后台任务（jobs）完成：定时任务/长任务等 → 记录并播报
  const jobsSvc = ctx.get('jobs')
  if (jobsSvc !== undefined) {
    try {
      const offJobs = jobsSvc.onJobDone((snapshot, owner) => {
        try {
          if (!snapshot || snapshot.status !== 'completed') return
          if (state.announcedJobs.has(snapshot.id)) return
          state.announcedJobs.add(snapshot.id)
          if (snapshot.kind === 'subagent') return // 子代理任务由父会话完成播报，避免重复
          const ownerId = owner?.session?.id || owner?.id || snapshot.ownerSession
          if (!shouldAnnounceOther(ownerId)) return
          const label = String(snapshot.label || '任务').slice(0, 80)
          const detail = String(snapshot.detail || '').slice(0, 60)
          recordOtherDone(ownerId || '(后台任务)', `任务「${label}」已完成${detail ? `：${detail}` : ''}`, '后台任务')
        } catch {}
      })
      ctx.effect(() => offJobs, 'voice-call: jobs listener')
    } catch (e) { ctx.logger.warn(`voice-call: jobs 监听不可用: ${String(e && e.message || e)}`) }
  }
}
