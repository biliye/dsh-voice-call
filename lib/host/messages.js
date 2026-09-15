// 语音事件队列与插件消息（2026-09-15 从 lib/index.js 拆出）
//
// 这里承载两件容易踩坑的事：
//   1. 事件队列用单调递增时间戳当游标（host 重启后 seq 不归零，客户端 since 不会跳过新事件）
//   2. 插件注入消息的 source 必须满足 DSH released 契约 ContextFormed：
//      form=notice 必须带非空 string summary，其余 form 一律不得带 summary（违反会让整个会话历史无法加载）
export function createMessages(state) {
  const pushEvent = (ev) => {
    // 用单调递增时间戳作游标：host 重启后 seq 不归零，客户端 since 不会跳过新事件
    const now = Date.now()
    state.eventSeq = now > state.eventSeq ? now : state.eventSeq + 1
    state.events.push({ seq: state.eventSeq, ...ev })
    if (state.events.length > 600) state.events.splice(0, state.events.length - 600)
  }
  const msg = (text, source) => ({ id: `va-${Date.now()}-${state.msgCounter++}`, role: 'user', content: [{ type: 'text', text }], source })
  const USER_SRC = { kind: 'user' }
  // 插件消息 source 必须满足 DSH 的 released 契约（ContextFormed）：
  //   form='notice' 必须携带非空 string summary（也是聊天里折叠行显示的单行摘要）；
  //   其余 form（instructions/catalog/snapshot/relay/recall）一律不得携带 summary。
  // 违反契约的记录会让该会话的 v0→v1 迁移整体被拒
  //（"agent/inbox/spliced ... inserted message source summary must be a string"），
  // 历史无法加载、专属会话无法 resume——所以这里把 form 与正文一起传入，由正文生成摘要。
  const noticeSummary = (text) => String(text || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const pluginSrc = (form, text) => ({
    kind: 'plugin',
    plugin: 'voice-assistant',
    form,
    ...(form === 'notice' ? { summary: noticeSummary(text) } : {}),
  })
  const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  // 读取会话事件列表：兼容不同 DSH 运行时 —— 新版 Session 不再暴露 .events 数组，
  // 需用 snapshotEvents()/ownEvents()/eventsSnapshot（内部 .log 的只读快照）读取。
  const sessionEvents = (agent) => {
    const s = agent?.session
    if (!s) return []
    try {
      if (Array.isArray(s.events)) return s.events
      if (Array.isArray(s.eventsSnapshot)) return s.eventsSnapshot
      if (typeof s.snapshotEvents === 'function') {
        const all = s.snapshotEvents()
        if (Array.isArray(all)) return all
      }
      if (typeof s.ownEvents === 'function') {
        const own = s.ownEvents()
        if (Array.isArray(own)) return own
      }
    } catch {}
    return []
  }
  const lastAssistantText = (agent) => {
    const evs = sessionEvents(agent)
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.type === 'assistant/message') {
        const t = textOf(e.data?.message?.content)
        if (t) return t
      }
    }
    return ''
  }
  return { pushEvent, msg, USER_SRC, noticeSummary, pluginSrc, textOf, sessionEvents, lastAssistantText }
}
