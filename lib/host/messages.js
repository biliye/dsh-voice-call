// 语音事件队列与插件消息（2026-09-15 从 lib/index.js 拆出）
//
// 这里承载两件容易踩坑的事：
//   1. 事件队列用单调递增时间戳当游标（host 重启后 seq 不归零，客户端 since 不会跳过新事件）
//   2. 插件注入消息的 source 必须同时满足两代会话格式的契约（见下面 pluginSrc 的长注释）：
//      旧格式（v0–v3）要求 { kind:'plugin', plugin:'voice-assistant' } & ContextFormed；
//      新格式（v4 起）的 kind 必须是「生产者自有」取值，字面量 'plugin' 会让写入当场被拒
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
  // ---------- 插件消息 source：两代会话格式各一套（2026-10-02 修复「插件没有自动播报」） ----------
  //
  // 症状：DSH 升到会话格式 v4 之后，插件的完成播报 / 人格注入 / 任务汇报一条都发不出去，
  // 语音会话最后一条记录停在用户上一次说话；Host 侧抛的是
  //   "format v4 message requires a producer-owned source kind"
  //（DSH 的会话格式 v3→v4 在 message-sources 的 source() 里校验）。
  //
  // v4 的契约（都已在 app.asar 里核对过）：
  //   · 解释型消息槽——user/message、agent/inbox/spliced.inserted[]、assistant/message、
  //     tool/result、session/title-llm-request.messages[]——的 source 必须是对象、kind 非空、
  //     且**不等于字面量 'plugin'**（"Producer attribution | Interpreted message slots require
  //     an object source with a nonempty, non-`plugin` kind"）。未知 kind 本身是允许的。
  //   · 校验发生在**写入编码**阶段：codec.encodeEvent → assertV4RowAdmission →
  //     assertV4SourceRowAdmission → source()。所以旧写法不是"先写进去、以后加载失败"，
  //     而是 steer / inject / followup 当场抛错——播报静默丢失，历史里什么都看不到。
  //   · v4 的 kind 是「生产者自有」的：DSH 的 v3→v4 转换表把「非一方插件名」一律写成
  //     `plugin:<原名>`。本插件的旧记录迁移后正是 `plugin:voice-assistant`
  //     （已在 $DSH_HOME/sessions/.../voice-call-main/session.v4.jsonl.zstd 里核对：
  //     kind='plugin:voice-assistant' 共 130 条，form=instructions/notice 与 summary 都保留）。
  //     所以 v4 会话继续用同一个 kind：历史与后续写入同源，GUI 也把它们当同一种通知渲染。
  //
  // 为什么不能一刀切换成新 kind：v2→v3 迁移阶段用白名单 SOURCE_KINDS 拒收它不认识的
  // source kind（"cannot safely transform unclassified message source"，白名单里只有
  // 'plugin' 等老 kind，没有 plugin:*）。若在 v0–v2 会话里写新 kind，等用户升级 DSH 时
  // 整个会话会无法迁移/加载（本插件历史上就栽过一次"专属会话无法加载"）。
  // 因此按**目标会话自己的格式版本**二选一；v3 会话虽不会被 v3→v4 拒收，也仍然走老写法，
  // 让旧日志只走那条走熟了的路。
  //
  // 版本取自 `agent.session.header.version`（DSH 自己的 delivery-accepted 记录也用这一处）。
  // 读不到（极老的 SessionHeader 没有 version）时按旧格式走——那是本插件一直以来的写法，
  // 而 v4 宿主必定报告 4。
  //
  // ContextFormed 部分两代完全一致：form='notice' 必须携带非空 string summary（也是聊天里
  // 折叠行显示的单行摘要）；其余 form（instructions/catalog/snapshot/relay/recall）一律不得
  // 携带 summary。违反它会让该会话的 v0→v1 迁移整体被拒
  //（"agent/inbox/spliced ... inserted message source summary must be a string"），
  // 历史无法加载、专属会话无法 resume——所以这里把 form 与正文一起传入，由正文生成摘要。
  const noticeSummary = (text) => String(text || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const PRODUCER = 'voice-assistant'
  const contextFormed = (form, text) => ({
    form,
    ...(form === 'notice' ? { summary: noticeSummary(text) } : {}),
  })
  const sessionFormatVersion = (agent) => {
    const v = Number(agent?.session?.header?.version)
    return Number.isSafeInteger(v) && v > 0 ? v : 0
  }
  // 第三个参数是**目标会话的 agent**（决定 source 形状）；没有它就按旧格式发。
  const pluginSrc = (form, text, agent) => (sessionFormatVersion(agent) >= 4
    ? { kind: `plugin:${PRODUCER}`, ...contextFormed(form, text) }
    : { kind: 'plugin', plugin: PRODUCER, ...contextFormed(form, text) })
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
