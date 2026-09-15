// @linxin666/dsh-voice-call — Host half
// 语音通话助手：专属工作区/会话（自动创建、跨重启保持）、任务分发（子代理会话）、
// 语音文本注入、TTS/云端 ASR 中转、主动进度检查、voice_task 动态工具、voiceAssistant 联动服务。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const name = 'voice-call'

const inject = ['agents', 'timer', 'subprocess', 'webServer', 'tools', 'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'sandboxPolicy']

// ---------- 专属工作区/会话（固定身份，跨重启保持同一会话） ----------
const VOICE_SESSION_ID = 'voice-call-main'
const VOICE_SESSION_TITLE = '语音通话'
const VOICE_WORKSPACE_DIR = 'voice-call'
const VOICE_WORKSPACE_TITLE = '语音通话'
const ENSURE_RETRY_MS = 5000
const ENSURE_MAX_TRIES = 40
// 专属会话不直接执行的重型/耗时工具（任务一律交给子代理会话）。
// 工具名因部署而异：restrict 遇到未知名称会抛错，已在 setup 中容错跳过。
const VOICE_DENY_TOOLS = ['bash', 'pwsh', 'run_code', 'workflow', 'ralph', 'subagent', 'subagent_fork', 'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_cluster', 'ssh_tunnel', 'job_kill', 'job_list', 'job_output', 'interrupt_agent', 'send_message', 'list_agents']
const VOICE_QUICK_REPLY_PROMPT_HEAD = [
  '你是「语音通话」专属会话：用户通过语音与你对话，你的回复会被语音朗读，必须极其简短。',
  '行为要求：',
  '1. 快速回复：每次回复最多 1-2 句话、尽量控制在 40 字以内，口语化、直接给结论；不要寒暄、不要复述用户的话、不要解释思考过程。回复会被整句朗读，正文必须是真人说话式的自然口语，可用「嗯」「好嘞」「哎呀」「哈哈」等语气词（这些词会被念出来）。',
]
const VOICE_QUICK_REPLY_PROMPT_TAIL = [
  '2. 静默执行：任务分发、执行中状态、失败、重试、核查、尝试各种方案等过程性信息一律不要对用户说出；只在任务有明确最终结果，或必须询问用户选择时，才用一句话简短汇报或提问。',
  '3. 任务外派：需要文件读写、代码执行、长时间研究、多步任务等耗时工作，或用户要求执行任务时，调用 voice_task 工具（action=create）分发给独立子代理会话执行，不要自己动手；分发后最多用一句话告知「已开始处理」，之后静默等待。',
  '3.5 停止任务：用户要求停止/取消某个任务时，先用 voice_task（action=list）找到任务 taskId，再用 action=stop 停止它，然后用一句话告知已停止。',
  '4. 会话连续：所有语音对话都保存在本会话（voice-call-main），本体重启后依然延续同一会话，可以引用之前的对话内容。',
  '5. 任务完成结果与「其他会话 / 后台任务完成」的播报会由系统注入到本会话，届时只用一句话转述核心结果，不要逐条复述原文；转述是说给用户听的，也要用口语短句并带上语气词或情绪标记，不要名词堆叠的汇报腔（如「后台修复的播报」「这个语音插件」这类书面说法）。',
]
// 朗读方式标记的提示词必须按「朗读提供商 × 导演模式」生成——这里是最容易出错的地方：
//   · MiniMax / OpenAI 兼容端点没有中文风格标签，自创的（轻声）（温柔）会被逐字念出来，
//     所以旧规则一律禁止；
//   · MiMo 原生支持中文风格标签与 [音频标签]（导演模式就是靠它演绎的），此时禁止反而
//     让模型无法表达语气，必须放开成「可用」并给出示例。切换提供商后提示词要跟着变。
const toneRuleFor = (provider, directorMode) => {
  const usable = '（笑）（轻笑）（叹气）（呼吸）（清嗓）（哽咽）（惊讶）（咳嗽）'
  const base = '1.5 语气标签与朗读约束：你的回复会被整句朗读，情绪要靠「语气词 + 情绪标记」表达，而不是颜文字/emoji——这些符号不会被读出来，只会让语气失控。情绪标记可用' + usable + '，一条回复最多 1-2 个，放在情绪最自然的位置；多句回复时不要只在句首放一个——承载结论或收尾的那一句也要带上语气词或情绪标记，否则后半句会被念得很平、很生硬；'
  const noSigns = '除这些允许的标记外，正文一律不要出现颜文字（如 (⁄ ⁄•⁄ω⁄•⁄ ⁄)）、emoji（如 😄 🐟 ✨）、星号、Markdown 或任何不会被朗读的文字。此规则优先于人格设定：即使人格要求卖萌或使用颜文字，也请把情绪写进语气词和情绪标记里。'
  if (provider !== 'mimo') {
    return base + '只能用上面列出的标记，不要自创——没有对应实现的标记（如（轻声）（温柔））会被逐字念成"轻声""温柔"，想表达轻声、温柔、认真这类语气就用语气词和短句节奏，不要写标记；' + noSigns
  }
  // MiMo：这些中文标记是原生标签，会被演绎出来而不是念出来
  const mimoTags = '这台语音引擎（MiMo）原生支持中文风格/音频标签：可用（东北话）（粤语）（四川话）（河南话）（温柔）（高冷）（慵懒）（俏皮）（磁性）（沙哑）（叹气）（大笑）（哽咽）（颤抖）（气声）（唱歌）等，也可以写英文插话标签 (laughs)(sighs)(breath)；这些标签会被演绎成对应语气，不要因为担心被念出来而回避。'
  if (directorMode === 'auto') {
    return base + mimoTags + '导演模式已开启：请在回复最前面先给出演绎指令，写完指令后必须另起一行只输出三个连字符 --- ，再在下面写真正要朗读的正文。指令格式固定为三行，每行以【角色】【场景】【指导】开头：\n【角色】说话人的身份、性格底色与说话习惯\n【场景】此刻在和谁说话、情绪处在什么位置、想要达到什么效果\n【指导】语速、气息、停顿、重音、音色质感、情绪起伏等演绎要领\n--- \n（这里写真正要说给用户听的那 1-2 句话）\n注意：--- 之前的内容是给语音引擎的演绎指令，不会被朗读；--- 之后才是正文，要短、要口语。' + noSigns
  }
  if (directorMode === 'fixed') {
    return base + mimoTags + '本会话已在设置页配置固定「导演剧本」，语音引擎会按该剧本演绎你的每一句回复，因此你不需要再输出任何指令或结构化内容，只写要朗读的正文即可。' + noSigns
  }
  return base + mimoTags + noSigns
}
// 最终提示词由 voicePromptText() 按「朗读提供商 × 导演模式」在每次组装时拼接（见 apply()）

const API = {
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

const MAX_JSON_BODY_BYTES = 24 * 1024 * 1024

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req) {
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

// 语音播报只念对话内容：Aegis 路由契约等会要求模型在回复里声明「Route: fast-path（闲聊）」
// 这类元信息行——它们不是对用户说的话，一旦进语音管线就会被逐字念出来（实测 MiniMax 会读出
// “Route fast-path”）。助手回复进入语音事件队列（面板显示 + TTS）之前在这里整行剔除。
const META_LINE_RE = /^\s*(?:[-*·•]\s*)?(?:route|路由|aegis\s+reason\s+note|trace\s+digest)\s*[:：]/i
const stripMetaLines = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line) => {
    if (!META_LINE_RE.test(line)) return line
    // 声明与正文挤在同一行（「Route: …。正文」）时只剪声明，避免把正文一起丢掉
    const rest = line.replace(META_LINE_RE, '')
    const cut = rest.search(/[。！？!?]/)
    return cut === -1 ? '' : rest.slice(cut + 1).trim()
  })
  .join('\n')
  .trim()

function apply(ctx, config) {
  config ||= {}
  const agents = ctx.agents
  if (agents === undefined) return

  // ---------- 状态 ----------
  let voiceSessionId = null
  let persona = ''
  let taskSeq = 0
  let msgCounter = 0
  let eventSeq = 0
  const events = []
  const tasks = new Map()

  const pushEvent = (ev) => {
    // 用单调递增时间戳作游标：host 重启后 seq 不归零，客户端 since 不会跳过新事件
    const now = Date.now()
    eventSeq = now > eventSeq ? now : eventSeq + 1
    events.push({ seq: eventSeq, ...ev })
    if (events.length > 600) events.splice(0, events.length - 600)
  }
  const msg = (text, source) => ({ id: `va-${Date.now()}-${msgCounter++}`, role: 'user', content: [{ type: 'text', text }], source })
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
    const text = `[语音助手人格] ${persona}`
    const evs = sessionEvents(agent)
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i]
      if (e.type !== 'user/message') continue
      if (textOf(e.data?.content) === text) return true
    }
    return false
  }
  const injectPersona = (agent) => {
    if (!agent || !persona) return
    if (personaInjected(agent)) return
    try { agent.inject(msg(`[语音助手人格] ${persona}`, pluginSrc('instructions'))) }
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
  let voiceReady = false
  let voiceWorkspaceId = null
  let voiceWorkspaceTitle = ''
  let voiceWorkspaceObj = null
  let ensuring = null
  let ensureTimer = null
  let ensureTries = 0
  // 朗读提供商与导演模式：由客户端设置页同步过来（POST /api/voice-call/tts-settings）。
  // 只影响「朗读规则提示词」——真正的朗读行为由每次 /api/voice-call/tts 请求自带的配置决定。
  let ttsProvider = 'minimax'
  let directorMode = 'off'
  const voicePromptText = () => [...VOICE_QUICK_REPLY_PROMPT_HEAD, toneRuleFor(ttsProvider, directorMode), ...VOICE_QUICK_REPLY_PROMPT_TAIL].join('\n')

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
    if (ensuring) return ensuring
    ensuring = (async () => {
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
      voiceWorkspaceId = String(ws.id)
      voiceWorkspaceTitle = ws.title
      voiceWorkspaceObj = ws
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
      voiceSessionId = VOICE_SESSION_ID
      voiceReady = true
      ensureTries = 0
      if (ensureTimer !== null) { const t = ensureTimer; ensureTimer = null; try { t() } catch {} }
      pushEvent({ kind: 'ready', voiceSessionId: VOICE_SESSION_ID, workspaceId: voiceWorkspaceId, workspaceTitle: voiceWorkspaceTitle })
      return true
    })()
    try { return await ensuring } finally { ensuring = null }
  }
  const runEnsure = async () => {
    if (voiceReady || ensuring) return
    try { await ensureVoiceWorld() }
    catch (e) {
      ensureTries += 1
      ctx.logger.warn(`voice-call: 专属工作区/会话初始化失败（第 ${ensureTries} 次）: ${String(e && e.message || e)}`)
      if (ensureTries >= ENSURE_MAX_TRIES) return
      if (ensureTimer === null) ensureTimer = ctx.setTimeout(() => { ensureTimer = null; runEnsure() }, ENSURE_RETRY_MS)
    }
  }

  // ---------- node 子进程网络桥（TTS / 云端 ASR） ----------
  // payload 通过 stdin 传入（Windows 命令行长度限制 ~32KB，音频 base64 会超，
  // argv 传 JSON 会 spawn ENAMETOOLONG）。stdin reader 包装 + 脚本主体。
  const STDIN_BOOT = "let _i='';process.stdin.on('data',c=>_i+=c);process.stdin.on('end',()=>{const cfg=JSON.parse(_i);"
  const STDIN_END = "});"
  const runNode = async (script, payload) => {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) return { ok: false, error: 'subprocess unavailable' }
    let nodePath
    try { nodePath = await subprocess.resolveExecutable('node') }
    catch { return { ok: false, error: 'node executable not found on PATH' } }
    const policy = ctx.get('sandboxPolicy')
    const cwd = policy?.workspaceRoot || '.'
    let handle
    try {
      handle = subprocess.spawn({
        argv: [nodePath, '-e', STDIN_BOOT + script + STDIN_END],
        cwd,
        stdio: { stdin: 'pipe', stdout: { maxBytes: 32 * 1024 * 1024 }, stderr: { maxBytes: 65536 } },
        graceMs: 45000,
      })
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    try {
      if (handle.stdin) {
        handle.stdin.write(JSON.stringify(payload))
        handle.stdin.end()
      }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    let outcome
    try { outcome = await handle.done } catch (e) { return { ok: false, error: String(e && e.message || e) } }
    let text = ''
    try { text = handle.collected.stdout?.readFrom(0)?.text?.trim() || '' } catch {}
    if (!text) {
      let errText = ''
      try { errText = handle.collected.stderr?.readFrom(0)?.text?.trim() || '' } catch {}
      const detail = errText ? `: ${errText.slice(0, 300)}` : (outcome?.signal ? ` (signal ${outcome.signal})` : '')
      return { ok: false, error: `no output (exit ${outcome.exitCode})${detail}` }
    }
    try { return JSON.parse(text) }
    catch { return { ok: false, error: `bad JSON: ${text.slice(0, 300)}` } }
  }

  const TTS_MINIMAX = "const https=require('https');const body=JSON.stringify({model:cfg.model||'speech-02-hd',text:cfg.text,stream:false,voice_setting:{voice_id:cfg.voice||'male-qn-qingse',speed:cfg.speed||1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}});const u=(()=>{try{return new URL(String(cfg.baseUrl||'').trim())}catch(e){return null}})()||new URL('https://api.minimax.chat/v1/t2a_v2');if(cfg.groupId)u.searchParams.set('GroupId',cfg.groupId);const req=https.request(u,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey,'Content-Length':Buffer.byteLength(body)}},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.setTimeout(20000,()=>req.destroy(new Error('request timeout')));req.write(body);req.end();"
  const TTS_OPENAI = "const https=require('https');const http=require('http');const body=JSON.stringify({model:cfg.model||'tts-1',input:cfg.text,voice:cfg.voice||'alloy',speed:cfg.speed||1,response_format:'mp3'});const u=(()=>{try{return new URL(String(cfg.baseUrl||'').trim())}catch(e){return null}})()||new URL('https://api.openai.com/v1/audio/speech');const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)};if(cfg.apiKey)headers['Authorization']='Bearer '+cfg.apiKey;const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>{const buf=Buffer.concat(d);if(res.statusCode>=200&&res.statusCode<300)process.stdout.write(JSON.stringify({ok:true,audio:buf.toString('base64'),mime:res.headers['content-type']||'audio/mpeg'}));else process.stdout.write(JSON.stringify({status:res.statusCode,body:buf.toString('utf8').slice(0,1500)}));});});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.setTimeout(20000,()=>req.destroy(new Error('request timeout')));req.write(body);req.end();"
  // MiMo-V2.5-TTS 走 OpenAI 兼容的 chat/completions，而不是音频合成端点：朗读正文放在
  // role=assistant 消息里，导演模式指令（【角色】【场景】【指导】）放在 role=user 消息里，
  // 两者是不同的通道——user 消息只作演绎指导，本身不会被朗读出来。音频经
  // choices[0].message.audio.data（base64）返回；认证用与 MiniMax 相同的 Bearer 头
  // （官方同时支持 api-key 头，这里只用一种，少一个配置项）。
  const TTS_MIMO = "const https=require('https');const http=require('http');const msgs=[];if(cfg.instruction)msgs.push({role:'user',content:String(cfg.instruction)});msgs.push({role:'assistant',content:cfg.text||''});const body=JSON.stringify({model:cfg.model||'mimo-v2.5-tts',messages:msgs,audio:{voice:cfg.voice||undefined,format:cfg.format||'wav'}});const u=(()=>{try{return new URL(String(cfg.baseUrl||'').trim())}catch(e){return null}})()||new URL('https://api.xiaomimimo.com/v1/chat/completions');const headers={'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey,'Content-Length':Buffer.byteLength(body)};const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.setTimeout(30000,()=>req.destroy(new Error('request timeout')));req.write(body);req.end();"
  const ASR_OPENAI = "const https=require('https');const http=require('http');const boundary='----va'+Date.now();const audio=Buffer.from(cfg.audioBase64||'','base64');const pre=Buffer.from('--'+boundary+'\\r\\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.'+(cfg.ext||'webm')+'\"\\r\\nContent-Type: '+(cfg.mime||'audio/webm')+'\\r\\n\\r\\n');let post='\\r\\n--'+boundary;if(cfg.model){post+='\\r\\nContent-Disposition: form-data; name=\"model\"\\r\\n\\r\\n'+cfg.model}post+='\\r\\n--'+boundary+'--\\r\\n';const body=Buffer.concat([pre,audio,Buffer.from(post)]);const u=new URL(cfg.baseUrl||'https://api.openai.com/v1/audio/transcriptions');const headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length};if(cfg.apiKey)headers['Authorization']='Bearer '+cfg.apiKey;const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.write(body);req.end();"

  // ---------- 语气标签（情绪标记 → TTS 插话标签） ----------
  // 语音助手可在回复正文中插入情绪标记（如 （笑）（叹气）），朗读前在这里统一处理：
  // MiniMax speech-2.8 系列原生支持插话标签 (laughs)/(sighs)/(breath) 等，转换为原生标签；
  // OpenAI 兼容 TTS 与 speech-02 等旧模型不支持，一律剥离后只朗读正文，避免把标签念出来。
  const TONE_NATIVE = ['laughs', 'chuckle', 'sighs', 'breath', 'inhale', 'exhale', 'clear-throat', 'coughs', 'crying', 'pant', 'gasps', 'emm', 'humming', 'groans', 'applause']
  const TONE_ALIAS = {
    '笑': 'laughs', '轻笑': 'chuckle', '叹气': 'sighs', '呼吸': 'breath', '深呼吸': 'breath',
    '吸气': 'inhale', '呼气': 'exhale', '清嗓': 'clear-throat', '清嗓子': 'clear-throat',
    '咳嗽': 'coughs', '哽咽': 'crying', '惊讶': 'gasps', '喘气': 'pant',
  }
  // 「朗读方式」标记：模型偶尔会自创（实测出现过（轻声））。MiniMax 只认上面那些插话标签，
  // 没有"轻声/耳语"这类标签——自创的标记留在正文里就会被逐字念成"轻声"。这些词一律删除：
  // 丢掉一次语气，好过把标记念给用户听。
  const TONE_STRIP = ['轻声', '小声', '低语', '耳语', '轻语', '温柔', '微笑', '大笑', '严肃', '平静', '慵懒', '俏皮', '撒娇', '无奈', '沉默', '停顿']
  const TONE_INNER = '笑|轻笑|叹气|呼吸|深呼吸|吸气|呼气|清嗓|清嗓子|咳嗽|哽咽|惊讶|喘气|'
    + TONE_NATIVE.join('|') + '|' + TONE_STRIP.join('|')
  const TONE_FULL_RE = new RegExp('[（(]\\s*(?:' + TONE_INNER + ')\\s*[)）]', 'gi')
  const TONE_DANGLING_RE = new RegExp('[（(]\\s*(?:' + TONE_INNER + ')\\s*$')
  // MiMo 原生的音频/风格标签（官方风格表）——这些是「可朗读标记」，在 MiMo 上要原样保留。
  // 它们大多含汉字（东北话/唱歌），按 isReadableToken 的通用规则本会被当颜文字丢掉，
  // 所以必须显式登记；对 MiniMax / OpenAI 兼容端点仍需剥掉（见 stripStyleTags）。
  const MIMO_STYLE_TAGS = ['开心', '悲伤', '愤怒', '恐惧', '惊讶', '兴奋', '委屈', '平静', '冷漠', '怅然', '欣慰', '无奈', '愧疚', '释然', '嫉妒', '厌倦', '忐忑', '动情', '温柔', '高冷', '活泼', '严肃', '慵懒', '俏皮', '深沉', '干练', '凌厉', '磁性', '醇厚', '清亮', '空灵', '稚嫩', '苍老', '甜美', '沙哑', '醇雅', '夹子音', '御姐音', '正太音', '大叔音', '台湾腔', '东北话', '四川话', '河南话', '粤语', '孙悟空', '林黛玉', '唱歌', 'sing', 'singing']
  const MIMO_STYLE_FULL_RE = new RegExp('[（(]\\s*(?:' + MIMO_STYLE_TAGS.join('|') + ')\\s*[)）]', 'gi')
  // 朗读前清理不可读符号（只在 TTS 前执行，正文/面板显示不受影响）：
  // 1) 括号表情（如 (⁄ ⁄•⁄ω⁄•⁄ ⁄)，括号内无汉字/数字的纯符号串——有汉字/数字的普通
  //    括注如（明天 9 点）、情绪标记（笑）、原生标签 (laughs) 一律保留）；
  // 2) 「朗读方式」标记（TONE_STRIP，如（轻声）（温柔））直接删除——MiniMax 没有对应
  //    原生标签可映射，留着就会被逐字念出来（MiMo 认这些中文标签，见 miMoToneTags）；
  // 3) emoji（含 ZWJ 序列/变体选择符/肤色修饰符）；4) 清理产生的多余空格。
  // 「明确念不出来的标记」判定：TONE_STRIP 的任何提供商都念不出来；MiMo 风格标签只有
  // 在朗读端不是 MiMo 时才不可读（keepStyleTags=true 表示朗读端是 MiMo，能演绎它们）。
  // 只有这些整词才整段删除；普通括注（含汉字/数字，如（明天 9 点））一律保留——
  // 把「含汉字就删」当规则会误删正常内容。
  const toneUnreadable = (t, keepStyleTags) => TONE_STRIP.includes(t)
    || (!keepStyleTags && MIMO_STYLE_TAGS.includes(t))
  // 括号内是否是可朗读的内容：含汉字/数字（普通括注（明天 9 点）、情绪标记（笑））或
  // 已知原生标签 (laughs) 都保留；纯符号串（颜文字 (⁄ ⁄•⁄ω⁄•⁄ ⁄)）整段丢掉。
  // 注意方向：判据是「含汉字/数字 ⇒ 保留」，反过来写会把颜文字当成可读内容。
  // keepStyleTags=true 时不把 MiMo 风格标签当不可读——MiMo 能演绎它们（见 miMoToneTags）。
  const isReadableToken = (inner, keepStyleTags) => {
    const t = String(inner).trim().toLowerCase()
    if (!t) return false
    if (toneUnreadable(t, keepStyleTags)) return false
    if (TONE_NATIVE.includes(t)) return true
    if (Object.prototype.hasOwnProperty.call(TONE_ALIAS, t)) return true
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(t) || /[0-9]/.test(t)
  }
  // 只清理不可读内容（emoji 与颜文字），保留发音标记原样——具体标记由各提供商
  // 自己的转换函数处理（MiniMax 映射成英文插话标签，MiMo 原样透传）。
  const cleanSpeechSymbols = (s, keepStyleTags) => String(s || '')
    .replace(/[（(][^（）()]{1,24}[)）]/g, (m) => (isReadableToken(m.slice(1, -1), keepStyleTags) ? m : ''))
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[ \t\u3000]{2,}/g, ' ')
    .replace(/\s+(?=[\u3400-\u9fff\uff00-\uffef])/g, '')
    .replace(/([\u3400-\u9fff\uff00-\uffef])\s+/g, '$1')
    .trim()
  // MiniMax：情绪标记 → 英文插话标签；keep=false（speech-02 等旧模型）时全部剥离只读正文
  const convertToneTags = (text, keep) => {
    let s = String(text || '')
    // 正文被截断留下半个标记（右括号被切掉）时直接去掉，避免被朗读出来
    s = s.replace(TONE_DANGLING_RE, '')
    // 先清理 emoji/颜文字（保留发音标记），再做情绪标记 → MiniMax 原生插话标签
    s = cleanSpeechSymbols(s, false)
    return s.replace(TONE_FULL_RE, (raw) => {
      const inner = raw.replace(/[（()）\s]/g, '').toLowerCase()
      if (!keep) return ''
      const native = TONE_ALIAS[inner] || inner
      return /^[a-z-]+$/.test(native) && TONE_NATIVE.includes(native) ? `(${native})` : ''
    })
  }
  // MiMo：情绪标记、中文风格标签（（东北话）（唱歌）（叹气））与原生英文标签原样保留，
  // 交给 MiMo 当音频/风格标签演绎——这是它相对 MiniMax 的关键差别，不能按 MiniMax 的
  // 规则删掉。tone='strip'（已关导演模式）时才把情绪标记删掉只读正文，但风格标签仍保留
  // （风格标签不算「朗读方式标记」，MiMo 本来就能演绎）。
  const miMoToneTags = (text, tone) => {
    const s = String(text || '').replace(TONE_DANGLING_RE, '')
    const cleaned = cleanSpeechSymbols(s, true)
    if (tone !== 'strip') return cleaned
    return cleaned.replace(TONE_FULL_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
  }
  // ---------- 导演模式指令块 ----------
  // 导演模式（auto）：助手回复里先给出结构化演绎指令，再用 --- 分隔真正要朗读的正文。
  // 指令块 → MiMo 的 user 消息（演绎指导），正文 → assistant 消息（朗读内容）。
  // 逐行扫描而不是写一个大正则：标记是被包在【】里还是裸写、行内冒号、行前空白、
  // 标记词本身是更长词的前缀（如「角色扮演」），这些情况用正则极易踩坑（实测出现过两种
  // 错位：\s* 吃掉换行让懒惰匹配退化成空串；以及裸写「角色：」被当成标记前缀匹配）。
  // 官方格式是「【角色】正文」（括号后直接写内容，没有冒号），但也兼容「角色：正文」，
  // 所以冒号是可选的，靠「括号成对」或「有冒号」来确认这是一个标记行。
  const DIRECTOR_MARKERS = [
    { field: '角色', re: /^(?:【\s*(?:角色|人设)\s*】\s*[:：]?\s*|(?:角色|人设)\s*[:：]\s*)(.*)$/ },
    { field: '场景', re: /^(?:【\s*(?:场景|情境)\s*】\s*[:：]?\s*|(?:场景|情境)\s*[:：]\s*)(.*)$/ },
    { field: '指导', re: /^(?:【\s*(?:指导|演绎(?:指导|要领))\s*】\s*[:：]?\s*|(?:指导|演绎(?:指导|要领))\s*[:：]\s*)(.*)$/ },
  ]
  const isDashLine = (line) => /^-{3,}$/.test(String(line || '').trim())
  // 解析不出结构时返回 null——调用方必须降级为「无导演指令」而不是把整段当正文送去朗读，
  // 否则会把【角色】【场景】【指导】逐字念给用户听。
  const parseDirectorBlock = (text) => {
    const s = String(text || '')
    if (!s.trim()) return null
    const lines = s.split(/\r?\n/)
    const parts = []
    let li = 0
    for (let k = 0; k < DIRECTOR_MARKERS.length; k += 1) {
      const m = lines[li]?.trim().match(DIRECTOR_MARKERS[k].re)
      if (!m) return null          // 标记缺失或顺序不对
      parts.push(lines[li].trim()) // 原样保留标记行（含括号写法），直接作为 user 消息发出
      li += 1
      // 标记行之后的续行（例如多行【指导】）也算该段指令，直到下一个标记行 / 分隔行 / 结尾
      while (li < lines.length && !isDashLine(lines[li]) && !DIRECTOR_MARKERS.some((mk) => mk.re.test(lines[li].trim()))) {
        parts.push(lines[li].trim())
        li += 1
      }
    }
    while (li < lines.length && !isDashLine(lines[li])) li += 1
    if (li >= lines.length) return null   // 没有 --- 分隔符 → 解析失败
    li += 1
    const speak = lines.slice(li).join('\n').replace(/^\s+|\s+$/g, '')
    if (!speak) return null
    // 正文里若混进了另一段结构化指令，宁可当作解析失败降级，也不冒险朗读
    if (DIRECTOR_MARKERS.some((mk) => mk.re.test(speak.split(/\r?\n/)[0].trim()))) return null
    return { directive: parts.join('\n'), speak }
  }
  // 导演模式（fixed）的固定剧本在 ttsOnce 里直接取用（见 instruction），这里不再单独包装
  // auto 模式下正文仍带着「【角色】…」这类结构化残留（例如模型给了指令块但没用 --- 分隔）时，
  // 整段不朗读也不能把指令念出来——拦截在 prepareSpeech 里对所有提供商生效。
  // 用与解析同一套标记正则，避免「解析判定失败但残留检测也判失败」而放行朗读。
  const hasDirectorResidue = (s) => String(s || '').split(/\r?\n/)
    .some((line) => DIRECTOR_MARKERS.some((mk) => mk.re.test(line.trim())))
  // 正文里可能要剥掉的 MiMo 风格标签：这些是 MiMo 原生标签，对 MiniMax / OpenAI 兼容端点
  // 没有对应实现，换端点朗读时必须删掉，否则会被逐字念成「东北话」。
  // 朗读提供商与生成回复所用的提供商是两件事，不能混为一谈。
  const stripStyleTags = (s) => String(s || '').replace(MIMO_STYLE_FULL_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
  // ---------- TTS 发送记录（定位"生硬"：到底发了什么文本、用哪个模型、有没有回退） ----------
  // 每次 /api/voice-call/tts 记一行 JSONL 到 $DSH_HOME/logs/voice-call-tts.log（与
  // vision-router.log 同目录，不往「语音通话」工作区里塞文件），只保留最近 200 行。
  // 含：客户端送来的文本、每次尝试实际发出的文本与模型、成功/失败、耗时。
  // 只用于排障，不含任何密钥；要停掉直接删掉 ttsOnce 里的 finish() 包装即可。
  const TTS_LOG_KEEP = 200
  const ttsLog = (entry) => {
    try {
      const dir = join(resolveDshHome(), 'logs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'voice-call-tts.log')
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      if (lines.length > TTS_LOG_KEEP) writeFileSync(file, lines.slice(-TTS_LOG_KEEP).join('\n') + '\n', 'utf8')
    } catch (e) { ctx.logger.warn(`voice-call: TTS 日志写入失败: ${String(e && e.message || e)}`) }
  }

  // ---------- MiMo 音色克隆样本（mimo-v2.5-tts-voiceclone） ----------
  // 官方没有「先注册 voice_id」这一步：样本以 DataURL 随**每次**合成请求发出（audio.voice）。
  // 这里只负责把磁盘上的样本文件准备成 DataURL，并按官方限制校验：仅 mp3/wav、样本 base64 ≤10MB。
  // 样本来源：
  //   1) 设置页「克隆样本」填的路径（可填绝对路径）；
  //   2) 留空时用插件数据目录 $DSH_HOME/voice-call/voice-clone/ 下的样音（优先 sample.mp3/sample.wav）。
  // 读盘按 (路径, 大小, mtime) 缓存 DataURL——同一份 2MB 样本每轮重读 + base64 编码纯属浪费。
  const CLONE_SAMPLE_DIR = join(resolveDshHome(), VOICE_WORKSPACE_DIR, 'voice-clone')
  const CLONE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024
  const CLONE_SAMPLE_MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
  const cloneSampleCache = new Map()
  // 留空时的默认样音：先认 sample.mp3 / sample.wav，再退到目录里第一个 mp3/wav
  const defaultCloneSamplePath = () => {
    for (const f of ['sample.mp3', 'sample.wav']) {
      const p = join(CLONE_SAMPLE_DIR, f)
      try { if (statSync(p).isFile()) return p } catch {}
    }
    let names = []
    try { names = readdirSync(CLONE_SAMPLE_DIR) } catch { return '' }
    const hit = names.filter((f) => /\.(mp3|wav)$/i.test(f)).sort()[0]
    return hit ? join(CLONE_SAMPLE_DIR, hit) : ''
  }
  const resolveCloneSample = (explicitPath) => {
    const given = String(explicitPath || '').trim()
    const file = given || defaultCloneSamplePath()
    if (!file) {
      return { ok: false, error: `未配置克隆样本：在设置页「克隆样本」填一个 .mp3/.wav 路径，或把样音放到 ${CLONE_SAMPLE_DIR}` }
    }
    const dot = String(file).lastIndexOf('.')
    const mime = dot > 0 ? CLONE_SAMPLE_MIME[String(file).slice(dot).toLowerCase()] : ''
    if (!mime) return { ok: false, error: `克隆样本只支持 mp3/wav：${file}` }
    let st
    try { st = statSync(file) } catch { return { ok: false, error: `克隆样本不存在：${file}` } }
    if (!st.isFile()) return { ok: false, error: `克隆样本不是文件：${file}` }
    const key = `${file}|${st.size}|${st.mtimeMs}`
    const hit = cloneSampleCache.get(key)
    if (hit) return { ...hit, cached: true }
    let buf
    try { buf = readFileSync(file) } catch (e) { return { ok: false, error: `克隆样本读取失败：${String(e && e.message || e)}` } }
    const b64 = buf.toString('base64')
    if (b64.length > CLONE_SAMPLE_MAX_BYTES) {
      return { ok: false, error: `克隆样本过大：base64 ${(b64.length / 1024 / 1024).toFixed(1)}MB / 文件 ${(buf.length / 1024 / 1024).toFixed(1)}MB，上限 10MB base64：${file}` }
    }
    const out = { ok: true, path: file, bytes: buf.length, dataUrl: `data:${mime};base64,${b64}`, cached: false }
    // 只留最近几条：来回换样本时不至于让缓存无限增长
    if (cloneSampleCache.size > 4) cloneSampleCache.clear()
    cloneSampleCache.set(key, out)
    return out
  }

  const ttsOnce = async (text, config) => {
    const cfg = config || {}
    const startedAt = Date.now()
    const requested = String(text || '')
    const attempts = []
    let truncated = false
    const provider = cfg.provider === 'openai' ? 'openai' : (cfg.provider === 'mimo' ? 'mimo' : 'minimax')
    // MiniMax 默认 speech-2.8-hd：该系列支持文本情绪标记/插话标签；speech-02 系列
    // 不支持，会把标签当字念出来。OpenAI 兼容 TTS 同样不支持 → keep=false 一律剥离。
    // MiMo 默认 mimo-v2.5-tts（预置音色）。-voiceclone 也支持：样本文件 → DataURL 走 audio.voice
    // （见 resolveCloneSample，官方无 voice_id 注册步骤）；-voicedesign（文本描述音色）本轮仍未接。
    const model = String(cfg.model || '').trim() || (provider === 'minimax' ? 'speech-2.8-hd' : (provider === 'mimo' ? 'mimo-v2.5-tts' : ''))
    const toneCapable = provider === 'minimax' && /^speech-2\.8/i.test(model)
    // 导演模式：先做「分离指令块 → 压缩正文 → 语气标签转换」的统一准备，各提供商分支只管发请求。
    // 顺序很关键（踩过坑）：
    //   1) 必须先用完整原文分离指令块——若先按 maxChars 截断，较长的回复会在 --- 之前被
    //      截掉，指令块再也解析不出来，导演模式会静默失效；
    //   2) 截断只作用于真正的正文，不把指令块算进最大字数；
    //   3) 结构解析不出来、正文里还留着标记行时整段不读（suppress），绝不把指令念出来；
    //   4) 最后才做语气标签转换（MiniMax 映射成英文插话标签，MiMo 原样透传）。
    // 调用方（client）必须把原始回复**原样**送进来：折叠换行或提前截断都会压坏结构，上面 1) 就没了。
    // 正文压缩：优先取第一句（到句末标点），整体不超过 maxChars；一句都没说完就按 maxChars 硬截断
    // 并置 truncated（面板提示「已截断」）。只作用于 --- 之后的正文，指令块已在上面分离掉。
    const briefForSpeech = (text, maxChars) => {
      const t = String(text || '').replace(/\s+/g, ' ').trim()
      if (!t || !(maxChars > 0) || t.length <= maxChars) return { text: t, truncated: false }
      const first = t.match(/^.*?[。！？!?…]/)
      if (first && first[0].length > 10 && first[0].length <= maxChars) return { text: first[0], truncated: false }
      return { text: t.slice(0, maxChars) + '…', truncated: true }
    }
    const prepareSpeech = (raw) => {
      const maxChars = Number(cfg.maxChars) || 0
      const s = String(raw || '')
      const dir = directorInfo(s)
      // 结构解析失败、正文里仍带着【角色】这类标记行（模型给了指令块却没用 --- 分隔）时，
      // 整段不朗读也不能把指令念出来
      if (!dir.separated && hasDirectorResidue(s)) return { text: '', suppress: true }
      const brief = briefForSpeech(dir.speak, maxChars)
      if (brief.truncated) truncated = true
      let body = brief.text
      if (provider === 'mimo') body = miMoToneTags(body, 'passthrough')
      else {
        body = convertToneTags(body, toneCapable)
        // MiMo 风格标签（东北话/唱歌）在 MiniMax / OpenAI 端点没有对应实现，一律删掉。
        // 注意不要用 MIMO_STYLE_FULL_RE.test() 做条件判断：该正则带 /g（replace 需要），
        // 带 /g 的正则用 test() 会推进 lastIndex，导致同样输入时真时假。
        body = stripStyleTags(body)
      }
      return { text: body, suppress: false }
    }
    // 导演模式：auto=本轮从回复里解析指令块并把指令发到 MiMo 的 user 通道；fixed=用设置页固定剧本；
    // 其余=不发演绎指令。注意「解析」与「模式」是解耦的：指令块存不存在是**文本本身的结构**，
    // 与朗读提供商/导演模式无关——只要解析成功就只朗读 --- 之后的正文。否则会出现「回复是在 auto 下
    // 生成的，随后把朗读切到 MiniMax（那里没有 user 指令通道，directorMode 被置 off）」这类场景下
    // 明明有干净正文却整段跳过、什么都不念的缺陷。
    // 解析不出结构时 speak 退回整段原文——由 prepareSpeech 的残留拦截兜底（绝不把指令当正文念）。
    const directorInfo = (raw) => {
      const parsed = parseDirectorBlock(raw)
      if (!parsed) return { instruction: '', speak: String(raw || ''), separated: false }
      return { instruction: cfg.directorMode === 'auto' ? parsed.directive : '', speak: parsed.speak, separated: true }
    }
    const instruction = String(cfg.directorMode === 'fixed' ? (cfg.directorScript || '') : '').replace(/^\s+|\s+$/g, '').slice(0, 4000)
    // 文本统一准备（截断 / 导演指令块分离 / 语气标签转换）——所有提供商走同一条路，
    // 避免某个分支漏掉「不把导演指令念出来」这条约束
    const prep = prepareSpeech(text)
    const suppressed = prep.suppress || !String(prep.text || '').trim()
    // 音色克隆样本：先声明（finish 的日志要读它），真正读盘放在 confirmed 要发请求之后
    let cloneSample = null
    // 所有出口都在这里记一条：送出去的文本 + 每次尝试的模型与实际文本（是否回退、是否剥掉了情绪标记）
    const finish = (result) => {
      ttsLog({
        t: new Date().toISOString(),
        provider,
        requestedModel: String(cfg.model || '').trim(),
        toneCapable,
        directorMode: cfg.directorMode || 'off',
        voice: cfg.voice || '',
        speed: Number(cfg.speed) || 1,
        requestedChars: requested.length,
        sentChars: String(prep.text || '').length,
        // 导演模式可观测性：解析出的/发送的指令长度，以及「因结构化残留而整段跳过朗读」的标记
        instructionChars: instruction.length,
        // 音色克隆可观测性：用的哪个样本文件、多大、是否命中缓存（不记样本内容）
        cloneSample: cloneSample ? `${cloneSample.path} (${(cloneSample.bytes / 1024).toFixed(0)}KB${cloneSample.cached ? ', cached' : ''})` : '',
        suppressed,
        truncated,
        requestedText: requested,
        attempts,
        ok: !!result.ok,
        error: result.error ? String(result.error).slice(0, 300) : '',
        ms: Date.now() - startedAt,
      })
      // sentChars 回传客户端：它按「实际送出的正文字数」估算播放时长/静音窗口，
      // 不能用原始回复长度（含导演指令块）——那会把麦克风静音过久。
      return result.ok ? { ...result, sentChars: String(prep.text || '').length } : result
    }
    // 音频容器魔数判定：ID3 / MPEG frame sync / RIFF(WAV) / fLaC / OggS。
    // 识别的容器越全，下面的 hex-vs-base64 兜底越不容易误判——漏一种（例如 WAV）就会让
    // 「带魔数」的优先分支落空，退化成按调用方 prefer 猜编码，把音频解成乱码字节。
    const hasAudioMagic = (b) => b.length >= 4 && (
      (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || // ID3
      (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) ||          // MPEG frame sync
      (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) || // RIFF/WAV
      (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) || // fLaC
      (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)    // OggS
    )
    // 该串是否只由 hex 字母表构成（可被当作 hex 解码）
    const looksHex = (s) => s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)
    // 把各家的响应体还原成音频字节。prefer 是「解析不出来时的编码假设」，只作 fallback：
    //   1) 优先取解码后带音频魔数的那一个（最可靠）；
    //   2) 都无魔数时，按调用方给的容器编码解（MiniMax 新格式=hex，MiMo=base64）。
    // 注意：base64 字母表是 hex 的超集，所以「纯 hex 文本」两种解都能出字节——只有魔数能定案，
    // 这也是必须先把 RIFF/WAV 补进 hasAudioMagic 的原因。
    const decodeAudio = (rawAudio, prefer) => {
      if (!rawAudio) return null
      const audio = String(rawAudio)
      const hexBuf = looksHex(audio) ? Buffer.from(audio, 'hex') : null
      const b64Buf = Buffer.from(audio, 'base64')
      let buf = null
      if (hexBuf && hasAudioMagic(hexBuf)) buf = hexBuf
      else if (hasAudioMagic(b64Buf)) buf = b64Buf
      else if (prefer === 'base64') buf = b64Buf
      else if (hexBuf && hexBuf.length > 0) buf = hexBuf
      else buf = b64Buf
      return buf && buf.length > 0 ? buf : null
    }
    // WAV/MIME 判定：只有真认出 RIFF 才敢标 audio/wav——标错会让浏览器解码失败
    const mimeOf = (buf, want) => {
      if (buf && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'audio/wav'
      return want === 'wav' ? 'audio/wav' : 'audio/mpeg'
    }
    const audioResult = (rawAudio, prefer, wantFormat) => {
      const buf = decodeAudio(rawAudio, prefer)
      if (!buf) return null
      return { ok: true, audio: buf.toString('base64'), mime: mimeOf(buf, wantFormat), truncated }
    }
    // 单次 MiniMax 合成：文本先做语气标签转换（支持则保留/转换，否则剥离）再调用
    const speakMinimax = async (speak, mdl) => {
      const payload = { text: speak, apiKey: cfg.apiKey || '', voice: cfg.voice || '', speed: Number(cfg.speed) || 1, groupId: cfg.groupId || '', model: mdl, baseUrl: cfg.baseUrl || '' }
      const res = await runNode(TTS_MINIMAX, payload)
      if (!res.ok && res.error) return { ok: false, error: res.error }
      try {
        const j = JSON.parse(res.body || '{}')
        const good = audioResult(j.data?.audio, 'hex', 'mp3')
        if (good) return good
        return { ok: false, error: `minimax: ${j.status_message || j.base_resp?.status_msg || 'no audio'}` }
      } catch (e) { return { ok: false, error: `minimax parse: ${String(e)}` } }
    }
    const note = (mdl, sentText, r) => attempts.push({
      model: mdl,
      sentText,
      // 送出去的文本里还剩哪些括注——用来发现模型自创、没有对应标签的「朗读方式」标记
      parentheticals: String(sentText).match(/[（(][^）)]{1,12}[）)]/g) ?? [],
      ok: !!r.ok,
      error: r.error ? String(r.error).slice(0, 200) : '',
    })
    // 文本统一准备（截断 / 导演指令块分离 / 语气标签转换）——所有提供商走同一条路，
    // 避免某个分支漏掉「不把导演指令念出来」这条约束
    const bodyText = prep.text
    if (suppressed) {
      // 两种跳过要分开报：结构化残留（可能把指令念出来）与「压根没有正文」，
      // 否则把一条没有导演指令块的普通空回复误报成导演模式解析失败。
      return finish({
        ok: false,
        error: prep.suppress
          ? 'director: 回复含导演指令块但缺少 --- 分隔的正文，已跳过朗读（避免把指令念出来）'
          : 'tts: 没有可朗读的正文',
      })
    }
    if (provider === 'mimo') {
      // 音色克隆（mimo-v2.5-tts-voiceclone）：voice 不是预置音色 ID，而是样本的 DataURL。
      // 样本解析失败就直接报错，绝不悄悄退回预置音色——否则你以为在用克隆音色，其实不是。
      const cloneModel = /voiceclone/i.test(model)
      if (cloneModel) {
        cloneSample = resolveCloneSample(cfg.voiceSample)
        if (!cloneSample.ok) return finish({ ok: false, error: `mimo voiceclone: ${cloneSample.error}` })
      }
      const res = await runNode(TTS_MIMO, {
        text: bodyText,
        instruction,
        apiKey: cfg.apiKey || '',
        voice: cloneModel ? cloneSample.dataUrl : (cfg.voice || ''),
        model,
        format: cfg.format || 'wav',
        baseUrl: cfg.baseUrl || '',
      })
      note(model, bodyText, { ok: false, error: res.error })
      if (!res.ok && res.error) return finish({ ok: false, error: res.error })
      try {
        const j = JSON.parse(res.body || '{}')
        if (res.status < 200 || res.status >= 300) {
          return finish({ ok: false, error: `mimo: ${j.error?.message || j.message || `HTTP ${res.status}`}` })
        }
        const good = audioResult(j.choices?.[0]?.message?.audio?.data, 'base64', cfg.format || 'wav')
        if (good) { attempts[attempts.length - 1].ok = true; return finish(good) }
        return finish({ ok: false, error: `mimo: ${j.error?.message || '无音频返回'}` })
      } catch (e) { return finish({ ok: false, error: `mimo parse: ${String(e)}` }) }
    }
    if (provider === 'minimax') {
      const first = await speakMinimax(bodyText, model)
      note(model, bodyText, first)
      if (first.ok || !toneCapable) return finish(first)
      // 账号未开通 / 参数不支持 speech-2.8 时，回退 speech-02-hd 并剥离语气标签重试一次
      const fallbackText = convertToneTags(text, false)
      const fallback = await speakMinimax(fallbackText, 'speech-02-hd')
      note('speech-02-hd', fallbackText, fallback)
      if (fallback.ok) return finish(fallback)
      return finish({ ok: false, error: `${first.error}（已尝试回退 speech-02-hd：${fallback.error}）` })
    }
    const res = await runNode(TTS_OPENAI, { text: bodyText, apiKey: cfg.apiKey || '', voice: cfg.voice || '', speed: Number(cfg.speed) || 1, model: '', baseUrl: cfg.baseUrl || '' })
    note('openai-compatible', bodyText, { ok: !!(res.ok && res.audio), error: res.error })
    if (res.ok && res.audio) return finish({ ok: true, audio: res.audio, mime: res.mime || 'audio/mpeg', truncated })
    if (!res.ok && res.error) return finish({ ok: false, error: res.error })
    return finish({ ok: false, error: `openai tts: ${res.status} ${String(res.body || '').slice(0, 300)}` })
  }

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
    const finished = [...tasks.values()].filter((t) => t.status !== 'running').sort((a, b) => b.updatedAt - a.updatedAt)
    if (finished.length <= PRUNE_KEEP_TASKS) return
    for (const t of finished.slice(PRUNE_KEEP_TASKS)) tasks.delete(t.taskId)
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
    const sessionId = `va-task-${Date.now()}-${taskSeq++}`
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
      const ap = voiceWorkspaceObj?.attachSession?.(sessionId)
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
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
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
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
    if (main) {
      const notice = `语音任务「${t.title}」已停止：${why}`
      try { main.followup(msg(notice, pluginSrc('notice', notice))) } catch {}
    }
    pruneTasks()
  }
  const stopTaskById = (taskId) => {
    const t = tasks.get(String(taskId || ''))
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
    const parent = voiceSessionId ? agents.get(voiceSessionId) : undefined
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
    if (voiceSessionId && parentSessionId !== voiceSessionId) return { ok: false, error: '仅允许从语音主会话分发任务' }
    const taskId = `task-${Date.now()}-${taskSeq++}`
    const parent = agents.get(parentSessionId)
    if (!parent) return { ok: false, error: '主会话不存在' }
    const ctxSummary = summarize(parent, 8)
    const fullPrompt = ctxSummary ? `[来自主语音会话的共享记忆]\n${ctxSummary}\n\n[任务]\n${prompt}` : prompt
    const r = await createTaskSession(parent, title, fullPrompt)
    if (!r.ok) return { ok: false, error: `create agent: ${r.error}` }
    // 先登记再 followup，避免创建后异常导致孤儿会话
    const t = { taskId, title, prompt, status: 'running', result: '', failReason: '', sessionId: r.sessionId, sessions: [r.sessionId], rollovers: 0, createdAt: Date.now(), updatedAt: Date.now() }
    tasks.set(taskId, t)
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
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
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

  // ---------- 其他会话任务完成跟踪（查看 + 语音播报） ----------
  // 规则：其他会话完成一轮（running→idle）或有后台任务（job）完成时，
  // 记录到 otherDones 并推送 other-done 事件；跳过专属语音会话、子代理会话
  // 以及用户当前正在查看的会话（由客户端上报 viewing）。
  let viewingSessionId = null
  let announceOtherDone = true
  const wasRunningOther = new Set()
  const otherDoneSeq = new Map()
  const otherDones = []
  const announcedJobs = new Set()
  const OTHER_DONES_MAX = 20
  const REPORT_COALESCE_MS = 2000
  const REPORT_MAX_ITEMS = 6
  const REPORT_MAX_LEN = 800
  // 待播报队列：其他会话/后台任务完成 → 合并成一条 → steer 进主会话（正在处理则并入当前轮，空闲则开新轮）
  const pendingReports = []
  let flushGen = 0
  const shouldAnnounceOther = (sessionId) => {
    if (!sessionId) return false
    if (sessionId === voiceSessionId) return false
    if (viewingSessionId && sessionId === viewingSessionId) return false
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
    if (pendingReports.length === 0) return
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
    if (!main) return
    const items = pendingReports.splice(0, pendingReports.length)
    const notice = buildReportNotice(items)
    try { main.steer(msg(notice, pluginSrc('notice', `完成播报：${items.length} 项任务已完成`))) }
    catch (e) { ctx.logger.warn(`voice-call: 完成播报 steer 失败: ${String(e && e.message || e)}`) }
  }
  const armFlush = () => {
    const gen = ++flushGen
    ctx.setTimeout(() => { if (gen === flushGen) flushReports() }, REPORT_COALESCE_MS)
  }
  const enqueueReport = (item) => {
    if (announceOtherDone === false) return
    if (pendingReports.some((x) => x.sessionId === item.sessionId && x.text === item.text)) return
    pendingReports.push(item)
    if (pendingReports.length > REPORT_MAX_ITEMS * 2) pendingReports.splice(0, pendingReports.length - REPORT_MAX_ITEMS * 2)
    armFlush()
  }
  const recordOtherDone = (sessionId, text, title) => {
    const t = String(text || '').trim().replace(/\s+/g, ' ')
    if (!t) return
    const item = { sessionId, text: t.slice(0, 300), title: title || '', time: Date.now() }
    otherDones.unshift(item)
    if (otherDones.length > OTHER_DONES_MAX) otherDones.length = OTHER_DONES_MAX
    pushEvent({ kind: 'other-done', sessionId: item.sessionId, text: item.text, title: item.title, time: item.time })
    enqueueReport(item)
  }

  // ---------- 会话事件：主会话助手回复 → 语音事件队列（供面板显示与 TTS） ----------
  // 回复先剔除 Route/流程等元信息行（stripMetaLines），否则会被整句朗读出来
  ctx.on('session/event', (session, event) => {
    if (voiceSessionId && session.id === voiceSessionId && event.type === 'assistant/message') {
      const t = stripMetaLines(textOf(event.data?.message?.content))
      if (t) pushEvent({ kind: 'reply', text: t })
    }
    for (const task of tasks.values()) {
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
      wasRunningOther.add(agentId)
      return
    }
    if (status !== 'idle') return
    // 主会话刚完成一轮回复：立即冲刷待播报队列（合并成一条 steer 进主会话）
    if (agentId === voiceSessionId) { wasRunningOther.delete(agentId); flushReports(); return }
    for (const task of tasks.values()) {
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
    if (!wasRunningOther.has(agentId)) return
    wasRunningOther.delete(agentId)
    try {
      const header = agent.session?.header
      if (!header || header.origin === 'subagent' || String(agentId).startsWith('va-task-')) return
      if (!shouldAnnounceOther(agentId)) return
      const evs = sessionEvents(agent)
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i]
        if (e.type === 'assistant/message') {
          const t = textOf(e.data?.message?.content)
          if (t && (otherDoneSeq.get(agentId) ?? 0) < (e.seq ?? 0)) {
            otherDoneSeq.set(agentId, e.seq ?? 0)
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
    if (voiceSessionId && agents.get(voiceSessionId) === undefined) {
      voiceSessionId = null
      voiceReady = false
      runEnsure()
    }
    for (const task of tasks.values()) {
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
          if (announcedJobs.has(snapshot.id)) return
          announcedJobs.add(snapshot.id)
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
      if (!voiceReady) runEnsure()
      writeJson(res, 200, { ok: true, voiceSessionId, ready: voiceReady, dedicated: true, workspaceId: voiceWorkspaceId, workspaceTitle: voiceWorkspaceTitle, persona, otherDones: otherDones.slice(0, 10), tasks: [...tasks.values()].map(taskView) })
    }),
    route(API.viewing, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      viewingSessionId = body?.sessionId ? String(body.sessionId) : null
      writeJson(res, 200, { ok: true })
    }),
    route(API.ensure, async ({ method, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      try { await ensureVoiceWorld() }
      catch (e) { return writeJson(res, 200, { ok: false, ready: false, error: String(e && e.message || e) }) }
      writeJson(res, 200, { ok: true, ready: true, voiceSessionId, workspaceId: voiceWorkspaceId, workspaceTitle: voiceWorkspaceTitle })
    }),
    route(API.bindSession, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      // 语音通话始终绑定专属会话（忽略传入的其他 sessionId）
      if (!voiceReady) runEnsure()
      if (voiceReady) {
        voiceSessionId = VOICE_SESSION_ID
        injectPersona(agents.get(voiceSessionId))
      }
      writeJson(res, 200, { ok: true, voiceSessionId, ready: voiceReady, dedicated: true })
    }),
    route(API.setPersona, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      persona = String(body?.persona || '').trim()
      injectPersona(voiceSessionId ? agents.get(voiceSessionId) : undefined)
      writeJson(res, 200, { ok: true })
    }),
    route(API.setAnnounce, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      announceOtherDone = body?.enabled !== false
      writeJson(res, 200, { ok: true, announceOtherDone })
    }),
    // 朗读提供商 / 导演模式同步：只用于让专属会话的提示词与当前朗读方式保持一致。
    // 提示词 section 用函数形式注册，这里改完下一轮组装就生效，不必重启会话。
    route(API.ttsSettings, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      ttsProvider = body?.provider === 'mimo' ? 'mimo' : (body?.provider === 'openai' ? 'openai' : 'minimax')
      directorMode = ['auto', 'fixed'].includes(body?.directorMode) ? body.directorMode : 'off'
      writeJson(res, 200, { ok: true, ttsProvider, directorMode })
    }),
    route(API.sendText, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const text = String(body?.text || '').trim()
      if (!text) return writeJson(res, 400, { ok: false, error: 'empty text' })
      const sessionId = body?.sessionId || voiceSessionId
      if (!sessionId) return writeJson(res, 400, { ok: false, error: 'voice session not ready' })
      if (sessionId !== voiceSessionId) return writeJson(res, 403, { ok: false, error: 'forbidden session' })
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
    route(API.cloudAsr, async ({ method, body, res }) => {
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const cfg = body?.config || {}
      const out = await runNode(ASR_OPENAI, { audioBase64: body?.audioBase64 || '', mime: body?.mime || 'audio/webm', ext: body?.ext || 'webm', baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '' })
      if (!out.ok && out.error) return writeJson(res, 500, { ok: false, error: out.error })
      try {
        const j = JSON.parse(out.body || '{}')
        if (j.text) return writeJson(res, 200, { ok: true, text: j.text })
        return writeJson(res, 500, { ok: false, error: `asr: ${out.status} ${String(out.body || '').slice(0, 300)}` })
      } catch (e) { return writeJson(res, 500, { ok: false, error: `asr parse: ${String(e)}` }) }
    }),
    route(API.tasks, async ({ method, body, res }) => {
      if (method === 'GET') return writeJson(res, 200, { ok: true, tasks: [...tasks.values()].map(taskView) })
      if (method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      const prompt = String(body?.prompt || '').trim()
      if (!prompt) return writeJson(res, 200, { ok: true, tasks: [...tasks.values()].map(taskView) })
      const title = String(body?.title || '').trim() || '语音任务'
      const parentSessionId = body?.parentSessionId || voiceSessionId
      if (!parentSessionId) return writeJson(res, 400, { ok: false, error: 'voice session not ready' })
      if (parentSessionId !== voiceSessionId) return writeJson(res, 403, { ok: false, error: 'forbidden session' })
      const r = await createTask(parentSessionId, title, prompt)
      writeJson(res, r.ok ? 200 : 400, r)
    }),
    route(API.taskStatus, async ({ query, res }) => {
      const t = tasks.get(query.searchParams.get('taskId') || '')
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
      const out = events.filter((e) => e.seq > since)
      writeJson(res, 200, { ok: true, events: out.map((e) => ({ ...e })) })
    }),
  ]

  const disposers = routes.map((r) => ctx.webServer.register(r))
  ctx.effect(() => () => { for (const d of disposers) d() }, 'voice-call: routes')

  // ---------- 动态工具：主会话 agent 主动分发任务 / 查进度 ----------
  const tool = defineTool({
    name: 'voice_task',
    description: '语音助手任务管理：把任务分发给「语音通话」工作区下的独立任务会话执行（与当前会话分离，任务会话保留在工作区可查看；上下文将满时自动新开会话续接）。可创建任务、查看进度、获取结果（成功/失败）、停止任务。仅语音通话主会话可调用。',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'status', 'list', 'stop'], description: '操作：create 创建任务；status 查询任务状态与结果；list 列出所有任务；stop 停止一个执行中的任务' },
      title: { type: 'string', description: '任务标题（action=create）' },
      prompt: { type: 'string', description: '任务详细指令（action=create）' },
      taskId: { type: 'string', description: '任务 ID（action=status / stop）' },
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const caller = exec?.agent?.session?.id || exec?.agent?.id
      if (!caller || (voiceSessionId && caller !== voiceSessionId)) return { ok: false, error: 'voice_task 仅语音通话主会话可调用', caller }
      if (voiceSessionId === null) return { ok: false, error: '尚未绑定语音会话，请先在悬浮球面板中开始通话' }
      const action = args?.action
      if (action === 'create') {
        const title = String(args?.title || '').trim() || '语音任务'
        const prompt = String(args?.prompt || '').trim()
        if (!prompt) return { ok: false, error: 'empty prompt' }
        const r = await createTask(caller, title, prompt)
        return r.ok ? { ok: true, taskId: r.taskId, sessionId: r.sessionId, message: `任务「${title}」已创建，在语音通话工作区任务会话 ${r.sessionId} 中执行` } : r
      }
      if (action === 'status') {
        const t = tasks.get(String(args?.taskId || ''))
        if (!t) return { ok: false, error: 'task not found' }
        return { ok: true, task: taskView(t) }
      }
      if (action === 'list') return { ok: true, tasks: [...tasks.values()].map(taskView) }
      if (action === 'stop') {
        const taskId = String(args?.taskId || '')
        if (!taskId) return { ok: false, error: 'taskId required' }
        return stopTaskById(taskId)
      }
      return { ok: false, error: 'unknown action' }
    },
  })
  const disposeTool = ctx.tools.register(tool)
  ctx.effect(() => disposeTool, 'voice-call: tool')

  // ---------- 供其他插件联动（如桌宠）的只读服务 ----------
  const disposeProvide = ctx.provide('voiceAssistant', {
    getState: () => ({ voiceSessionId, ready: voiceReady, dedicated: true, workspaceId: voiceWorkspaceId, workspaceTitle: voiceWorkspaceTitle, persona: persona || '' }),
    listTasks: () => [...tasks.values()].map(taskView),
    listOtherDones: () => otherDones.slice(0, 20),
    events: () => events.slice(-50).map((e) => ({ ...e })),
  })
  ctx.effect(() => disposeProvide, 'voice-call: service')

  // ---------- 启动后自动创建专属工作区与专属会话（失败自动重试） ----------
  ctx.setTimeout(() => runEnsure(), 1500)
}

export { apply, inject, name }
