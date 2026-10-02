// 本地语音识别适配器：复用 DSH「语音输入」插件的 SenseVoice 模型缓存
// （2026-10-02 新增，对应「用户不该重复安装 ASR 模型」这条需求）
//
// 背景：@deepseek-ai/dsh-experimental-voice-input-bundle 会把 SenseVoiceSmall
// (ONNX int8) 下载到 $DSH_HOME/speech-to-text/sensevoice/models/（约 240MB），
// 由它自己的 speechToText 服务（provider id 默认 sensevoice-local）托管。
// 本插件不再自带模型、也不再要求用户另装 FunASR Server：直接消费同一个服务，
// 模型只存在一份（sherpa-onnx-node + 原生运行库随 DSH 安装，也是现成的）。
//
// 取服务的方式是 ctx.get('speechToText')（DSH 里「可选依赖」的常规写法，
// 等价于 ctx.get(name, { strict: true })）：
//   · 只返回「正在激活」的提供者——bundle 没装/被停用/还没激活时返回 undefined，
//     这里给一句能照着做的错误，而不是让整个 voice-call 插件加载不了；
//   · 因此 **inject 里不能声明 speechToText**：cordis 的 inject 键都是硬依赖
//     （registry.ts 的 Inject.resolve 把数组项一律归一成 null → required），
//     声明了就等于「没装语音输入就别用语音通话」。
//
// 输入约束（照抄 speech-to-text 的 validateWave，与语音输入插件一致）：
//   恰好 16 kHz / 单声道 / PCM16 的规范 WAV。这条正好是 lib/client.js 里
//   encodeWav() 的产物——实时监听（VAD）路径天然合规；MediaRecorder 抓的
//   webm/opus 不合规，所以本地模式下必须提示用户开实时监听。
//
// 模型准备：provider.prepare() 会下载/加载模型，speechToText.transcribe() 之前
// 必须已就绪。首次使用（模型缺失）时模型下载要走网络，浏览器等不起一个长请求，
// 所以 recognize() 在「未就绪」时只触发准备并立刻回 { needsPrepare }，
// 由客户端轮询状态接口，就绪后重发同一段音频。

import { SERVICE, PROVIDER_ID } from '../config.js'

// 与端点上 maxDurationSeconds 的默认值一致（120 秒）
const MAX_DURATION_SECONDS = 120
const MAX_AUDIO_BYTES = 4 * 1024 * 1024
// 「唤醒并准备」最多同步等这么久：模型已缓存时 worker 启动通常 1-3 秒；
// 超过就回当前阶段让客户端继续轮询（首次下载 240MB 显然更久）。
const WAKE_TIMEOUT_MS = 12000
const WAKE_POLL_MS = 250
const LOG_KEEP = 400

// 规范 WAV 校验：返回秒数或 null（null 表示字节流不符合，调用方给用户看的错）
export function canonicalWavSeconds(buf) {
  const b = buf
  if (!b || b.length < 46) return null
  if (b.toString('ascii', 0, 4) !== 'RIFF') return null
  if (b.toString('ascii', 8, 12) !== 'WAVE') return null
  if (b.toString('ascii', 12, 16) !== 'fmt ') return null
  if (b.readUInt32LE(16) !== 16) return null
  if (b.readUInt16LE(20) !== 1) return null
  if (b.readUInt16LE(22) !== 1) return null
  if (b.readUInt32LE(24) !== 16000) return null
  if (b.readUInt32LE(28) !== 32000) return null
  if (b.readUInt16LE(32) !== 2) return null
  if (b.readUInt16LE(34) !== 16) return null
  if (b.toString('ascii', 36, 40) !== 'data') return null
  if (b.readUInt32LE(4) !== b.length - 8) return null
  if (b.readUInt32LE(40) !== b.length - 44) return null
  if ((b.length - 44) % 2 !== 0) return null
  return (b.length - 44) / 32000
}

// 不支持的音频（webm/opus、格式不合规、超时长）单独分类，客户端据此给不同提示
export class SpeechInputError extends Error {}

export function createLocalSpeech(deps = {}) {
  const {
    ctx,
    service = SERVICE.speechToText,
    providerId = PROVIDER_ID,
    // 「唤醒并准备」同步等待上限；测试里调小以便快速跑完失败路径
    wakeTimeoutMs = WAKE_TIMEOUT_MS,
  } = deps

  // ---------- 本地识别运行记录（排障用，不含音频内容） ----------
  // 每次「唤醒/准备」与「识别」各记一行到 $DSH_HOME/logs/voice-call-asr.log（保留最近
  // LOG_KEEP 行）。为什么必须有它：这条链路的关键状态（provider 阶段、是否真的触发了
  // prepare、识别耗时/文本长度）全在宿主进程里，用户只看到界面上一句话；出问题时没有
  // 日志就只能靠猜。这里刻意不记识别文本本身，只记长度。
  const asrLog = (entry) => {
    try {
      const dir = join(resolveDshHome(), 'logs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'voice-call-asr.log')
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      if (lines.length > LOG_KEEP) writeFileSync(file, lines.slice(-LOG_KEEP).join('\n') + '\n', 'utf8')
    } catch (e) { try { ctx.logger.warn(`voice-call: 本地识别日志写入失败: ${String(e && e.message || e)}`) } catch {} }
  }

  const serviceOf = () => {
    if (!ctx || typeof ctx.get !== 'function') return undefined
    try { return ctx.get(service) } catch { return undefined }
  }
  // 先按配置的 id 精确匹配；匹配不到时退化为「id/名字里含 sensevoice」的唯一提供者。
  // 为什么要有这层兜底：provider id 来自语音输入 bundle 的静态 patch（sensevoice-local），
  // 版本变动时可能改；一旦对不上，旧实现会静默地什么都不做（prepare 找不到 provider 直接
  // 返回、异常被吞），用户看到的就是「点了按钮没反应」。
  const providersOf = (svc) => {
    try { return svc?.snapshot?.().providers ?? [] } catch { return [] }
  }
  const providerOf = (svc) => {
    if (!svc) return undefined
    const list = providersOf(svc)
    const exact = list.find((p) => p.id === providerId)
    if (exact) return exact
    const fuzzy = list.filter((p) => /sensevoice/i.test(String(p.id || '') + ' ' + String(p.name || '')))
    return fuzzy.length === 1 ? fuzzy[0] : undefined
  }
  const unavailable = () => ({
    kind: 'service-missing',
    error: `DSH 本地识别服务（${service}）不可用：请在「设置 → 插件」里启用语音输入（@deepseek-ai/dsh-experimental-voice-input-bundle）后重试。启用后本插件直接复用它的 SenseVoice 模型缓存（$DSH_HOME/speech-to-text/sensevoice/models），不会再下载一份。`,
  })
  // 准备进度转成一句中文：模型已缓存时通常一闪而过（standby → 唤醒）
  const phaseText = (state) => {
    if (!state) return ''
    const step = state.step ? `（${state.step}）` : ''
    if (state.phase === 'checking') return '正在检查本地模型' + step
    if (state.phase === 'downloading') {
      const done = Number(state.completedBytes) || 0
      const total = Number(state.totalBytes) || 0
      const pct = total > 0 ? ` ${Math.round((done / total) * 100)}%` : ''
      return `正在下载语音模型${pct}（约 240MB，仅首次）`
    }
    if (state.phase === 'loading') return '正在加载语音模型'
    if (state.phase === 'waking') return '正在唤醒识别进程'
    if (state.phase === 'ready') return '本地识别已就绪'
    if (state.phase === 'failed') return '本地识别准备失败: ' + String(state.message || '未知原因')
    return ''
  }
  // 触发（或并入）provider 自己托管的准备任务；同一 provider 只会有一个任务。
  // 返回 { state, error }：**调用异常必须带出去**——旧实现把 svc.prepare() 的异常整个吞掉，
  // 于是「provider id 对不上 / 服务被卸载」这类失败在界面上表现为"点了没反应"。
  const prepare = (svc, provider, extra = {}) => {
    try {
      svc.prepare(provider.id)
    } catch (e) {
      const error = String((e && e.message) || e)
      asrLog({ t: new Date().toISOString(), op: 'prepare', provider: provider.id, ok: false, error, ...extra })
      return { state: preparationOf(provider), error }
    }
    const state = preparationOf(provider)
    asrLog({ t: new Date().toISOString(), op: 'prepare', provider: provider.id, ok: true, phase: state?.phase || '', ...extra })
    return { state, error: '' }
  }
  // 读 provider 的当前准备状态快照。
  // 注意 provider.preparation 是**对象**（含 prepare/snapshot/subscribe/cancel），
  // 不是状态本身——直接读它的 .phase 会永远是 undefined，从而把每个阶段都当成 ready
  // （这正是本轮实现里踩到的坑：模型没下载也显示"已就绪"）。
  const preparationOf = (provider) => {
    try { return provider.preparation?.snapshot?.() || null } catch { return null }
  }
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })
  // 启动/并入准备，并短暂等它离开 standby（= 把识别进程真的拉起来）。
  // 为什么值得同步等：模型已缓存时 worker 启动只要 1-3 秒，等到了就能立刻识别；
  // 不等的话用户点完按钮看不出任何变化（旧实现就是直接返回，界面上"没反应"）。
  const wake = async (svc, provider, extra = {}) => {
    const before = preparationOf(provider)
    const started = Date.now()
    if (before && before.phase === 'ready') return { state: before, error: '' }
    const { state, error } = prepare(svc, provider, extra)
    if (error) return { state, error }
    let current = state
    while (Date.now() - started < wakeTimeoutMs) {
      const phase = current?.phase || ''
      if (phase === 'ready' || phase === 'failed' || phase === 'cancelled') break
      await sleep(WAKE_POLL_MS)
      current = preparationOf(provider)
    }
    return { state: current, error: '' }
  }

  // 状态查询：available/provider/phase/ready/engine/providerName/action/waitedMs。
  // async 是有意的：prepare=true 时要真的等到识别进程起来（或超时）再回答，
  // 这样「🔄 检查 / 准备模型」点下去就有确切结果，而不是回了句"未准备"就没了。
  const status = async (options = {}) => {
    const wants = options.prepare === true
    const svc = serviceOf()
    if (!svc) {
      if (wants) asrLog({ t: new Date().toISOString(), op: 'prepare', ok: false, error: 'service-missing' })
      return { ok: false, engine: 'local', available: false, ...unavailable() }
    }
    const provider = providerOf(svc)
    if (!provider) {
      const ids = providersOf(svc).map((p) => p.id)
      const error = ids.length
        ? `本地识别里没有提供者「${providerId}」，也没有能唯一识别的 SenseVoice 提供者（当前：${ids.join('、')}）`
        : '本地识别服务已加载但没有任何提供者，请检查语音输入插件的配置'
      if (wants) asrLog({ t: new Date().toISOString(), op: 'prepare', ok: false, error, providers: ids })
      return { ok: false, engine: 'local', available: false, providers: ids, error }
    }
    let state = preparationOf(provider)
    let prepareError = ''
    if (wants) {
      const out = await wake(svc, provider)
      state = out.state || state
      prepareError = out.error || ''
    }
    const phase = state?.phase || 'ready'
    return {
      ok: true,
      engine: 'local',
      available: true,
      provider: provider.id,
      providerName: provider.name || provider.id,
      languages: provider.languages || [],
      phase,
      ready: phase === 'ready' || phase === 'standby',
      // 识别进程是否已经在内存里（standby=模型在磁盘、进程没起；ready=已加载可直接识别）
      hot: phase === 'ready',
      message: phaseText(state),
      action: wants ? (prepareError ? 'prepare-failed' : 'prepare') : 'inspect',
      ...(prepareError ? { prepareError } : {}),
    }
  }

  // 一段（16kHz 单声道 PCM16）WAV → 文本
  const recognize = async (audioBase64) => {
    const encoded = String(audioBase64 || '')
    if (!encoded) return { ok: false, code: 'empty', error: '没有收到音频数据' }
    let buf
    try { buf = Buffer.from(encoded, 'base64') } catch { return { ok: false, code: 'bad-audio', error: '音频 base64 解码失败' } }
    if (buf.length > MAX_AUDIO_BYTES) return { ok: false, code: 'too-large', error: `音频过大（${(buf.length / 1024 / 1024).toFixed(1)}MB，上限 4MB）` }
    const seconds = canonicalWavSeconds(buf)
    if (seconds === null) {
      return {
        ok: false,
        code: 'bad-format',
        error: '本地识别只接受 16kHz 单声道 PCM16 的 WAV：请开启设置页的「实时监听」（VAD 分段）后重试，MediaRecorder 录的 webm/opus 需要先转码',
      }
    }
    if (seconds > MAX_DURATION_SECONDS) return { ok: false, code: 'too-long', error: `录音 ${seconds.toFixed(1)} 秒，超过本地识别上限 ${MAX_DURATION_SECONDS} 秒` }

    const svc = serviceOf()
    if (!svc) {
      asrLog({ t: new Date().toISOString(), op: 'transcribe', ok: false, code: 'unavailable' })
      return { ok: false, code: 'unavailable', ...unavailable() }
    }
    const provider = providerOf(svc)
    if (!provider) {
      const st = await status()
      asrLog({ t: new Date().toISOString(), op: 'transcribe', ok: false, code: 'unavailable' })
      return { ok: false, code: 'unavailable', error: st.error || '本地识别提供者不可用' }
    }
    const started = Date.now()
    try {
      const spec = svc.resolve({ audio: buf, language: 'auto' })
      const out = await svc.transcribe(spec, new AbortController().signal)
      const text = String(out?.text || '').trim()
      asrLog({ t: new Date().toISOString(), op: 'transcribe', ok: true, provider: provider.id, seconds: Number(out?.audioSeconds) || seconds, ms: Date.now() - started, textChars: text.length })
      return { ok: true, text, seconds: Number(out?.audioSeconds) || seconds, inferenceSeconds: Number(out?.inferenceSeconds) || 0 }
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (e instanceof SpeechInputError || /Prepare the local speech provider/i.test(msg)) {
        const { state } = prepare(svc, provider, { trigger: 'transcribe' })
        return { ok: false, code: 'needs-prepare', phase: state?.phase || 'unprepared', message: phaseText(state) || '本地模型尚未就绪', error: msg }
      }
      asrLog({ t: new Date().toISOString(), op: 'transcribe', ok: false, provider: provider.id, ms: Date.now() - started, error: msg.slice(0, 300) })
      return { ok: false, code: 'failed', error: msg }
    }
  }

  return { status, recognize, canonicalWavSeconds, asrLog }
}
