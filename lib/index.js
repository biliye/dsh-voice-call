// @linxin666/dsh-voice-call — Host half
// 语音通话助手：专属工作区/会话（自动创建、跨重启保持）、任务分发（子代理会话）、
// 语音文本注入、TTS/云端 ASR 中转、主动进度检查、voice_task 动态工具、voiceAssistant 联动服务。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { mkdirSync } from 'node:fs'
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
const VOICE_QUICK_REPLY_PROMPT = [
  '你是「语音通话」专属会话：用户通过语音与你对话，你的回复会被语音朗读，必须极其简短。',
  '行为要求：',
  '1. 快速回复：每次回复最多 1-2 句话、尽量控制在 40 字以内，口语化、直接给结论；不要寒暄、不要复述用户的话、不要解释思考过程。',
  '2. 静默执行：任务分发、执行中状态、失败、重试、核查、尝试各种方案等过程性信息一律不要对用户说出；只在任务有明确最终结果，或必须询问用户选择时，才用一句话简短汇报或提问。',
  '3. 任务外派：需要文件读写、代码执行、长时间研究、多步任务等耗时工作，或用户要求执行任务时，调用 voice_task 工具（action=create）分发给独立子代理会话执行，不要自己动手；分发后最多用一句话告知「已开始处理」，之后静默等待。',
  '4. 会话连续：所有语音对话都保存在本会话（voice-call-main），本体重启后依然延续同一会话，可以引用之前的对话内容。',
  '5. 任务完成结果会由系统注入到本会话，届时只用一句话转述核心结果。',
].join('\n')

const API = {
  getState: '/api/voice-call/state',
  bindSession: '/api/voice-call/bind-session',
  ensure: '/api/voice-call/ensure',
  setPersona: '/api/voice-call/persona',
  viewing: '/api/voice-call/viewing',
  sendText: '/api/voice-call/send-text',
  tts: '/api/voice-call/tts',
  cloudAsr: '/api/voice-call/asr',
  tasks: '/api/voice-call/tasks',
  taskStatus: '/api/voice-call/task-status',
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
  const pluginSrc = (form) => ({ kind: 'plugin', plugin: 'voice-assistant', form })
  const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const lastAssistantText = (agent) => {
    const evs = agent?.session?.events || []
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
    const evs = agent?.session?.events || []
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
    const evs = agent?.session?.events || []
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

  // 专属会话的 scoped 世界：快速回复提示词（每次 create/resume 都会重新注册，
  // 因此重启后依然生效）+ 重型工具限制。
  const voiceSetup = (agentCtx) => {
    try {
      agentCtx.systemPrompt.section({
        name: 'voice-call:dedicated',
        order: 60,
        text: VOICE_QUICK_REPLY_PROMPT,
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
            const headers = await persistence.list()
            persisted = headers.some((h) => h.id === VOICE_SESSION_ID)
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
  const ASR_OPENAI = "const https=require('https');const http=require('http');const boundary='----va'+Date.now();const audio=Buffer.from(cfg.audioBase64||'','base64');const pre=Buffer.from('--'+boundary+'\\r\\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.'+(cfg.ext||'webm')+'\"\\r\\nContent-Type: '+(cfg.mime||'audio/webm')+'\\r\\n\\r\\n');let post='\\r\\n--'+boundary;if(cfg.model){post+='\\r\\nContent-Disposition: form-data; name=\"model\"\\r\\n\\r\\n'+cfg.model}post+='\\r\\n--'+boundary+'--\\r\\n';const body=Buffer.concat([pre,audio,Buffer.from(post)]);const u=new URL(cfg.baseUrl||'https://api.openai.com/v1/audio/transcriptions');const headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length};if(cfg.apiKey)headers['Authorization']='Bearer '+cfg.apiKey;const req=(u.protocol==='https:'?https:http).request(u,{method:'POST',headers},res=>{const d=[];res.on('data',c=>d.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,body:Buffer.concat(d).toString('utf8')})));});req.on('error',e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})));req.write(body);req.end();"

  const ttsOnce = async (text, config) => {
    const cfg = config || {}
    let truncated = false
    const maxChars = Number(cfg.maxChars) || 0
    if (maxChars > 0 && text.length > maxChars) {
      text = text.slice(0, maxChars) + '…'
      truncated = true
    }
    const provider = cfg.provider === 'openai' ? 'openai' : 'minimax'
    const payload = { text, apiKey: cfg.apiKey || '', voice: cfg.voice || '', speed: Number(cfg.speed) || 1, groupId: cfg.groupId || '', model: cfg.model || '', baseUrl: cfg.baseUrl || '' }
    const res = provider === 'openai' ? await runNode(TTS_OPENAI, payload) : await runNode(TTS_MINIMAX, payload)
    if (!res.ok && res.error) return { ok: false, error: res.error }
    if (provider === 'minimax') {
      try {
        const j = JSON.parse(res.body || '{}')
        const audio = j.data?.audio
        if (audio) {
          // MiniMax 新格式：data.audio 为 hex 编码的音频字节（纯 hex 文本）；
          // 旧格式为 base64。两种都尝试解码，优先取带音频魔数的结果。
          const isHex = audio.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(audio)
          const hexBuf = isHex ? Buffer.from(audio, 'hex') : null
          const b64Buf = Buffer.from(audio, 'base64')
          const looksAudio = (b) => b.length >= 4 && (
            (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || // ID3
            (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) ||          // MPEG frame sync
            (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) || // RIFF/WAV
            (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) || // fLaC
            (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)    // OggS
          )
          const buf = (hexBuf && looksAudio(hexBuf)) ? hexBuf : (looksAudio(b64Buf) ? b64Buf : (hexBuf && hexBuf.length > 0 ? hexBuf : b64Buf))
          if (buf.length > 0) return { ok: true, audio: buf.toString('base64'), mime: 'audio/mpeg', truncated }
        }
        return { ok: false, error: `minimax: ${j.status_message || j.base_resp?.status_msg || 'no audio'}` }
      } catch (e) { return { ok: false, error: `minimax parse: ${String(e)}` } }
    }
    if (res.ok && res.audio) return { ok: true, audio: res.audio, mime: res.mime || 'audio/mpeg', truncated }
    return { ok: false, error: `openai tts: ${res.status} ${String(res.body || '').slice(0, 300)}` }
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
    const meta = { origin: 'subagent', parentSession: parent.session.id, cwd: join(resolveDshHome(), VOICE_WORKSPACE_DIR) }
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
  const failTask = (t, reason) => {
    if (t.status === 'completed' || t.status === 'failed') return
    t.status = 'failed'
    t.failReason = String(reason || '未知原因')
    t.updatedAt = Date.now()
    pushEvent({ kind: 'task', taskId: t.taskId, status: 'failed', title: t.title, reason: t.failReason })
    const main = voiceSessionId ? agents.get(voiceSessionId) : undefined
    if (main) {
      // 必须用 followup（唤醒主会话 → 回复 → reply 事件 → 播报）；inject 只排队不唤醒，
      // 空闲主会话永远不回复，任务结果就不会播报
      try { main.followup(msg(`语音任务「${t.title}」失败：${t.failReason}`, pluginSrc('notice'))) } catch {}
    }
    pruneTasks()
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
      try { main.followup(msg(`语音任务「${t.title}」已完成（成功）：\n${text || '(无文本结果)'}`, pluginSrc('notice'))) } catch {}
    }
    pruneTasks()
  }
  const taskView = (t) => ({ taskId: t.taskId, title: t.title, status: t.status, result: t.result.slice(0, 500), failReason: t.failReason, sessionId: t.sessionId, sessions: t.sessions, rollovers: t.rollovers, createdAt: t.createdAt, updatedAt: t.updatedAt })

  // ---------- 其他会话任务完成跟踪（查看 + 语音播报） ----------
  // 规则：其他会话完成一轮（running→idle）或有后台任务（job）完成时，
  // 记录到 otherDones 并推送 other-done 事件；跳过专属语音会话、子代理会话
  // 以及用户当前正在查看的会话（由客户端上报 viewing）。
  let viewingSessionId = null
  const wasRunningOther = new Set()
  const otherDoneSeq = new Map()
  const otherDones = []
  const announcedJobs = new Set()
  const OTHER_DONES_MAX = 20
  const shouldAnnounceOther = (sessionId) => {
    if (!sessionId) return false
    if (sessionId === voiceSessionId) return false
    if (viewingSessionId && sessionId === viewingSessionId) return false
    return true
  }
  const recordOtherDone = (sessionId, text) => {
    const t = String(text || '').trim().replace(/\s+/g, ' ')
    if (!t) return
    const item = { sessionId, text: t.slice(0, 300), time: Date.now() }
    otherDones.unshift(item)
    if (otherDones.length > OTHER_DONES_MAX) otherDones.length = OTHER_DONES_MAX
    pushEvent({ kind: 'other-done', sessionId: item.sessionId, text: item.text, time: item.time })
  }

  // ---------- 会话事件：主会话助手回复 → 事件队列（供 TTS） ----------
  ctx.on('session/event', (session, event) => {
    if (voiceSessionId && session.id === voiceSessionId && event.type === 'assistant/message') {
      const t = textOf(event.data?.message?.content)
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
    for (const task of tasks.values()) {
      // 只认当前活动会话（续接后旧会话 idle 不结算任务）；无产出文本的 idle 交给监听进程超时判失败
      if (task.sessionId !== agentId) continue
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
      const evs = agent.session?.events || []
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i]
        if (e.type === 'assistant/message') {
          const t = textOf(e.data?.message?.content)
          if (t && (otherDoneSeq.get(agentId) ?? 0) < (e.seq ?? 0)) {
            otherDoneSeq.set(agentId, e.seq ?? 0)
            recordOtherDone(agentId, t)
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
      if (agent.status === 'idle' && t) { completeTask(task, agent); continue }
      if (agent.status === 'idle' && Date.now() - task.updatedAt > TASK_TIMEOUT_MS) { failTask(task, '超时无结果'); continue }
      // 仍在工作中：检查上下文是否将满，满了且尚未超过续接上限 → 新开一个会话续接
      if (agent.status === 'running' && Date.now() - task.updatedAt > TASK_TIMEOUT_MS) { failTask(task, '执行超时（长时间无进展）'); continue }
      if (agent.status === 'running' && task.rollovers < TASK_ROLLOVER_MAX && (t || (agent.session?.events?.length || 0) > 2)) {
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
          recordOtherDone(ownerId || '(后台任务)', `任务「${label}」已完成${detail ? `：${detail}` : ''}`)
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
    description: '语音助手任务管理：把任务分发给「语音通话」工作区下的独立任务会话执行（与当前会话分离，任务会话保留在工作区可查看；上下文将满时自动新开会话续接）。可创建任务、查看进度、获取结果（成功/失败）。仅语音通话主会话可调用。',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'status', 'list'], description: '操作：create 创建任务；status 查询任务状态与结果；list 列出所有任务' },
      title: { type: 'string', description: '任务标题（action=create）' },
      prompt: { type: 'string', description: '任务详细指令（action=create）' },
      taskId: { type: 'string', description: '任务 ID（action=status）' },
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
