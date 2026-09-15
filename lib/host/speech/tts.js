// TTS 文本准备、请求、失败回退与发送记录（2026-09-15 从 lib/index.js 拆出）
//
// 职责边界：本模块只负责"把助手回复变成可朗读的音频"，不负责路由与前端交互。
// state 写入约定：本模块是 state.cloneSampleCache 的唯一写者。
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { VOICE_WORKSPACE_DIR } from '../config.js'
import { convertToneTags, miMoToneTags } from './tone.js'
import { parseDirectorBlock, hasDirectorResidue, stripStyleTags } from './director.js'

export function createSpeech(state, deps) {
  const { ctx, bridge } = deps
  const { runNode, TTS_MINIMAX, TTS_OPENAI, TTS_MIMO } = bridge
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
    const hit = state.cloneSampleCache.get(key)
    if (hit) return { ...hit, cached: true }
    let buf
    try { buf = readFileSync(file) } catch (e) { return { ok: false, error: `克隆样本读取失败：${String(e && e.message || e)}` } }
    const b64 = buf.toString('base64')
    if (b64.length > CLONE_SAMPLE_MAX_BYTES) {
      return { ok: false, error: `克隆样本过大：base64 ${(b64.length / 1024 / 1024).toFixed(1)}MB / 文件 ${(buf.length / 1024 / 1024).toFixed(1)}MB，上限 10MB base64：${file}` }
    }
    const out = { ok: true, path: file, bytes: buf.length, dataUrl: `data:${mime};base64,${b64}`, cached: false }
    // 只留最近几条：来回换样本时不至于让缓存无限增长
    if (state.cloneSampleCache.size > 4) state.cloneSampleCache.clear()
    state.cloneSampleCache.set(key, out)
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
    // 生成的，随后把朗读切到 MiniMax（那里没有 user 指令通道，state.directorMode 被置 off）」这类场景下
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

  return { ttsOnce, ttsLog, resolveCloneSample, defaultCloneSamplePath }
}
