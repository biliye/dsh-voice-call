// 其他会话 / 后台任务完成跟踪与语音播报（2026-09-15 从 lib/index.js 拆出）
//
// 状态写入约定：本模块是 state 里以下字段的唯一写者——
//   viewingSessionId / announceOtherDone / wasRunningOther / otherDoneSeq /
//   otherDones / announcedJobs / pendingReports / flushGen
export function createAnnounce(state, deps) {
  const { ctx, agents, messages } = deps
  const { msg, pluginSrc, pushEvent } = messages
  // ---------- 其他会话任务完成跟踪（查看 + 语音播报） ----------
  // 规则：其他会话完成一轮（running→idle）或有后台任务（job）完成时，
  // 记录到 state.otherDones 并推送 other-done 事件；跳过专属语音会话、子代理会话
  // 以及用户当前正在查看的会话（由客户端上报 viewing）。
  const OTHER_DONES_MAX = 20
  const REPORT_COALESCE_MS = 2000
  const REPORT_MAX_ITEMS = 6
  const REPORT_MAX_LEN = 800
  // 待播报队列：其他会话/后台任务完成 → 合并成一条 → steer 进主会话（正在处理则并入当前轮，空闲则开新轮）
  const shouldAnnounceOther = (sessionId) => {
    if (!sessionId) return false
    if (sessionId === state.voiceSessionId) return false
    if (state.viewingSessionId && sessionId === state.viewingSessionId) return false
    return true
  }
  const resolveTitle = (agent) => {
    try { return ctx.get('sessionTitle')?.get(agent?.session)?.title || '' } catch { return '' }
  }
  const buildReportNotice = (items) => {
    const lines = []
    for (const it of items) {
      const label = it.title || (it.sessionId ? '其他会话' : '后台任务')
      const body = String(it.text || '').trim().replace(/\s+/g, ' ').slice(0, 150)
      lines.push(`· 「${label}」：${body || '（无结果）'}`)
    }
    const overflow = items.length - REPORT_MAX_ITEMS
    if (overflow > 0) lines.push(`（另有 ${overflow} 项完成，此处从略）`)
    let text = `【完成播报】以下任务已完成，请用一句话向用户转述核心结果，不要逐条复述：\n` + lines.slice(0, REPORT_MAX_ITEMS).join('\n')
    if (text.length > REPORT_MAX_LEN) text = text.slice(0, REPORT_MAX_LEN) + '…'
    return text
  }
  const flushReports = () => {
    if (state.pendingReports.length === 0) return
    const main = state.voiceSessionId ? agents.get(state.voiceSessionId) : undefined
    if (!main) return
    const items = state.pendingReports.splice(0, state.pendingReports.length)
    const notice = buildReportNotice(items)
    try { main.steer(msg(notice, pluginSrc('notice', `完成播报：${items.length} 项任务已完成`))) }
    catch (e) { ctx.logger.warn(`voice-call: 完成播报 steer 失败: ${String(e && e.message || e)}`) }
  }
  const armFlush = () => {
    const gen = ++state.flushGen
    ctx.setTimeout(() => { if (gen === state.flushGen) flushReports() }, REPORT_COALESCE_MS)
  }
  const enqueueReport = (item) => {
    if (state.announceOtherDone === false) return
    if (state.pendingReports.some((x) => x.sessionId === item.sessionId && x.text === item.text)) return
    state.pendingReports.push(item)
    if (state.pendingReports.length > REPORT_MAX_ITEMS * 2) state.pendingReports.splice(0, state.pendingReports.length - REPORT_MAX_ITEMS * 2)
    armFlush()
  }
  const recordOtherDone = (sessionId, text, title) => {
    const t = String(text || '').trim().replace(/\s+/g, ' ')
    if (!t) return
    const item = { sessionId, text: t.slice(0, 300), title: title || '', time: Date.now() }
    state.otherDones.unshift(item)
    if (state.otherDones.length > OTHER_DONES_MAX) state.otherDones.length = OTHER_DONES_MAX
    pushEvent({ kind: 'other-done', sessionId: item.sessionId, text: item.text, title: item.title, time: item.time })
    enqueueReport(item)
  }
  return {
    OTHER_DONES_MAX, REPORT_COALESCE_MS, REPORT_MAX_ITEMS, REPORT_MAX_LEN,
    shouldAnnounceOther, resolveTitle, buildReportNotice, flushReports, armFlush, enqueueReport, recordOtherDone,
  }
}
