// 「显示 DSH 的供应商」：把 DSH 自己已经配好的供应商读出来（2026-10-12 新增）
//
// 用户不该在语音通话的设置页里把 DSH 已经填过的东西再填一遍。供应商在 DSH 手里，
// 本模块**只读不写**：
//
//   DSH「设置 → 模型」写的供应商（llm 适配器的 providers 字典）。
//   读法是 settings.describe({ redactSecrets: true }) —— 设置服务自己的「读活配置 +
//   插件 schema」调用，也就是配置表单的数据源。只取本插件能真正用的形状：一个有
//   地址（baseURL / baseUrl，或者 DSH 内置目录里的地址）、并且至少声明了一个模型的供应商。
//   **密钥永远只是引用名**（apiKeyEnv），真正的值在每次请求时经 ctx.credentials 现取
//   （见 resolveDshKey），所以 DSH 里换 key，下一次朗读/识别就生效，设置页里也不需要再存
//   一份明文。
//
// 供应商来源可能缺席：没有 settings 服务、或者供应商还没配。缺了就返回空列表 + 一句能
// 照着做的说明，而不是让整个插件加载不了。

// 供应商的 provider 键（llm-pi-ai 的 providers 字典）→ 本插件能用的目标
function stringField(source, key) {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// MiMo 的 TTS 走 chat/completions（演绎指令与正文分两条消息），OpenAI 兼容的走
// /audio/speech。判定只看模型名：MiMo 的 TTS 模型一律以 mimo 开头
// （mimo-v2.5-tts / mimo-v2.5-tts-voiceclone），这一点在设置页也要显示给用户看。
export function dshFlavorOf(model) {
  return /^mimo/i.test(String(model || '').trim()) ? 'mimo' : 'openai'
}

// 模型可以写成对象数组（{ id }）或裸字符串数组两种形状，按 DSH 的读法都认
function readModels(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry.trim() : stringField(entry, 'id')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, flavor: dshFlavorOf(id) })
  }
  return out
}

// 一个供应商条目；地址或模型缺一就返回 undefined（由调用方记进 skipped 说明原因）
function readDshProvider(id, raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const baseUrl = stringField(raw, 'baseURL') ?? stringField(raw, 'baseUrl')
  if (baseUrl === undefined) return undefined
  const models = readModels(raw.models)
  if (models.length === 0) return undefined
  const keyRef = stringField(raw, 'apiKeyEnv')
  const api = stringField(raw, 'api')
  return {
    id,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    api: api || '',
    models,
    keyRef: keyRef || '',
  }
}

function skipReason(raw, hasCatalogRoute) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '不是一个供应商配置'
  const baseUrl = stringField(raw, 'baseURL') ?? stringField(raw, 'baseUrl')
  if (baseUrl === undefined) {
    return hasCatalogRoute
      ? '缺 baseURL：DSH 的内置目录里有这条路由，但地址没取到（目录没加载成功），所以暂时没有可发音频的地址'
      : '缺 baseURL：这条路由只写了凭据，DSH 的内置目录里也没有它，因此不知道把音频发到哪里——在 DSH「设置 → 模型」里给它填上 baseURL 即可'
  }
  return '没有声明任何模型，而识别/朗读请求必须带一个模型 id'
}

function serviceOf(ctx, name) {
  try {
    if (!ctx || typeof ctx.get !== 'function') return undefined
    return ctx.get(name)
  } catch { return undefined }
}

// DSH 自带的 pi-ai 目录：llm-pi-ai 给「只写凭据、不写地址」的路由解析端点用的就是它
// （`catalogProvider(id).baseUrl`，见 @deepseek-ai/dsh-llm-pi-ai 的 resolveRouteModels）。
// 所以这里用**同一份来源**给这类路由补地址，而不是猜一个域名出来。
//
// 加载可能失败：插件的 peer 依赖由宿主在运行时解析，插件自己的 node_modules 里没有这个包。
// 失败就记住「查不到」，绝不编地址，插件照常工作。
let catalogPromise
function catalogBaseUrls() {
  catalogPromise ??= (async () => {
    try {
      const mod = await import('@earendil-works/pi-ai/providers/all')
      const list = typeof mod?.builtinProviders === 'function' ? mod.builtinProviders() : []
      const map = new Map()
      for (const entry of Array.isArray(list) ? list : []) {
        if (entry && typeof entry.id === 'string' && typeof entry.baseUrl === 'string' && entry.baseUrl !== '') {
          map.set(entry.id, entry.baseUrl)
        }
      }
      return map
    } catch { return new Map() }
  })()
  return catalogPromise
}

// 原始读：settings.describe 里每一条 provider 路由，原样带出来（能不能用交给 assemble 判断）
function collectRawProviders(ctx) {
  const settings = serviceOf(ctx, 'settings')
  if (!settings || typeof settings.describe !== 'function') return { settingsAvailable: false, entries: [] }
  let forms
  try { forms = settings.describe({ redactSecrets: true }) } catch {
    // 设置服务答不上话 = 「没有可提供的供应商」，不是插件坏了
    return { settingsAvailable: true, entries: [] }
  }
  const entries = []
  for (const form of Array.isArray(forms) ? forms : []) {
    const raw = form?.value?.providers
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    for (const [id, profile] of Object.entries(raw)) entries.push({ id, raw: profile })
  }
  return { settingsAvailable: true, entries }
}

// 把原始路由归纳成「能用的供应商」与「跳过的（带原因）」
function assemble(entries, catalog) {
  const providers = []
  const skipped = []
  const seen = new Set()
  for (const { id, raw } of entries) {
    let provider = readDshProvider(id, raw)
    let fromCatalog = false
    if (provider === undefined) {
      // 只有凭据、没有地址的路由：用 DSH 目录里的地址补齐（目录里也没有就照实跳过）
      const catalogBase = catalog.get(id)
      if (typeof catalogBase === 'string' && catalogBase !== '') {
        const base = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
        provider = readDshProvider(id, { ...base, baseURL: catalogBase })
        fromCatalog = provider !== undefined
      }
    }
    if (provider === undefined) {
      const declared = typeof raw === 'object' && raw !== null ? readModels(raw.models) : []
      skipped.push({ id, models: declared.map((m) => m.id), reason: skipReason(raw, catalog.has(id)) })
      continue
    }
    const identity = `${provider.baseUrl}|${provider.models.map((m) => m.id).join(',')}`
    if (seen.has(identity)) continue
    seen.add(identity)
    providers.push(fromCatalog ? { ...provider, baseUrlFromCatalog: true } : provider)
  }
  return { providers, skipped }
}

// 读 DSH「设置 → 模型」里的供应商（同步版：只认写了地址的路由）。
// skipped 是刻意的：「列表里没有我的供应商」如果只是一个静默的空列表，用户无从知道是没配地址、
// 没写模型，还是根本没保存过。
export function inspectDshProviders(ctx) {
  const { settingsAvailable, entries } = collectRawProviders(ctx)
  if (!settingsAvailable) return { settingsAvailable: false, providers: [], skipped: [] }
  return { settingsAvailable: true, ...assemble(entries, new Map()) }
}

// 异步版：只写凭据的路由也补上 DSH 目录里的地址，因此能真正用起来。
// 请求路径（识别/朗读）与设置页列表都用这个版本——两边看到的是同一份东西。
export async function resolveDshProviders(ctx) {
  const { settingsAvailable, entries } = collectRawProviders(ctx)
  if (!settingsAvailable) return { settingsAvailable: false, providers: [], skipped: [] }
  const needsCatalog = entries.some((entry) => readDshProvider(entry.id, entry.raw) === undefined)
  const catalog = needsCatalog ? await catalogBaseUrls() : new Map()
  return { settingsAvailable: true, ...assemble(entries, catalog) }
}

// 供应商列表里找一条；找不到时给一句能照着做的错
export function findDshProvider(providers, id) {
  const wanted = String(id || '').trim()
  if (wanted === '') return undefined
  return (providers || []).find((p) => p.id === wanted)
}

// 模型 id 的形状校验走 DSH 的设置页，这里只保证「这条模型属于这个供应商」
export function findDshModel(provider, model) {
  const wanted = String(model || '').trim()
  if (!provider || wanted === '') return undefined
  return provider.models.find((m) => m.id === wanted)
}

// 取凭据：ctx.credentials.resolve(ref) 返回 { value, source } | undefined，
// 没有凭据服务时退回进程环境（与 DSH 自己的 openai 后端同一条路）。
// 空值一律当「没配」——空白不该冒充一个可用的密钥。
export async function resolveDshKey(ctx, ref) {
  const name = String(ref || '').trim()
  if (name === '') return undefined
  const credentials = serviceOf(ctx, 'credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(name)
      const value = typeof hit === 'string' ? hit : hit?.value
      if (typeof value === 'string' && value !== '') return value
    } catch {}
  }
  const ambient = typeof process !== 'undefined' ? process.env?.[name] : undefined
  return typeof ambient === 'string' && ambient !== '' ? ambient : undefined
}

// 拼接端点：DSH 供应商写的是**基地址**（http://127.0.0.1:8100/v1），而本插件的后端要完整
// 端点。用户若把端点整个填进 baseURL，也不要重复追加。
function endpointOf(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (base === '') return ''
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : base + suffix
}

// 识别目标：OpenAI 兼容的 /audio/transcriptions
export function dshAsrTarget(provider, model) {
  return {
    baseUrl: endpointOf(provider.baseUrl, '/audio/transcriptions'),
    model: String(model || '').trim(),
    keyRef: provider.keyRef || '',
  }
}

// 朗读目标：MiMo 味走 /chat/completions，其余走 OpenAI 兼容 /audio/speech
export function dshTtsTarget(provider, model) {
  const flavor = dshFlavorOf(model)
  return {
    flavor,
    provider: flavor,
    baseUrl: endpointOf(provider.baseUrl, flavor === 'mimo' ? '/chat/completions' : '/audio/speech'),
    model: String(model || '').trim(),
    keyRef: provider.keyRef || '',
  }
}

// 给「朗读」用的完整配置：客户端只报「哪个 DSH 供应商的哪个模型」，地址与密钥在这里补齐，
// 密钥因此不必进浏览器、也不会被写进 localStorage。
export async function resolveDshTtsConfig(ctx, cfg) {
  const { providers } = await resolveDshProviders(ctx)
  const provider = findDshProvider(providers, cfg?.dshProviderId)
  if (provider === undefined) {
    const ids = providers.map((p) => p.id)
    return {
      ok: false,
      error: ids.length
        ? `DSH 供应商里没有「${cfg?.dshProviderId}」（当前：${ids.join('、')}）：请在 DSH「设置 → 模型」里确认，或重新打开设置页刷新列表`
        : 'DSH 里还没有可用的供应商：请在 DSH「设置 → 模型」里添加一个（需要 baseURL 与至少一个模型）',
    }
  }
  const model = findDshModel(provider, cfg?.dshModel ?? provider.models[0]?.id)
  if (model === undefined) {
    return { ok: false, error: `供应商「${provider.id}」没有模型「${cfg?.dshModel}」（可选：${provider.models.map((m) => m.id).join('、')}）` }
  }
  const target = dshTtsTarget(provider, model.id)
  const apiKey = await resolveDshKey(ctx, target.keyRef)
  if (target.keyRef !== '' && apiKey === undefined) {
    return {
      ok: false,
      error: `供应商「${provider.id}」引用凭据 ${target.keyRef}，但 DSH 凭据库里没有它的值：请在 DSH「设置 → 模型」里为这个供应商填上 API Key（本插件不存这份密钥）`,
    }
  }
  const mimo = target.flavor === 'mimo'
  return {
    ok: true,
    provider: target.provider,
    baseUrl: target.baseUrl,
    model: target.model,
    keyRef: target.keyRef,
    config: {
      provider: target.provider,
      baseUrl: target.baseUrl,
      apiKey: apiKey ?? '',
      model: target.model,
      groupId: '',
      voice: String(cfg?.voice ?? ''),
      speed: cfg?.speed ?? 1,
      format: mimo ? (cfg?.format || 'wav') : 'mp3',
      // 只有 MiMo 味的端点有「演绎指令」通道；OpenAI 兼容端没有，硬发只会被念出来
      directorMode: mimo && ['auto', 'fixed'].includes(cfg?.directorMode) ? cfg.directorMode : 'off',
      directorScript: String(cfg?.directorScript ?? ''),
      maxChars: cfg?.maxChars,
      voiceSample: String(cfg?.voiceSample ?? ''),
      dshProviderId: provider.id,
    },
  }
}

// 给「识别」用的请求参数（云端 OpenAI 兼容路）：同样在这里补齐地址与密钥
export async function resolveDshAsrRequest(ctx, cfg) {
  const { providers } = await resolveDshProviders(ctx)
  const provider = findDshProvider(providers, cfg?.dshProviderId)
  if (provider === undefined) {
    const ids = providers.map((p) => p.id)
    return {
      ok: false,
      error: ids.length
        ? `DSH 供应商里没有「${cfg?.dshProviderId}」（当前：${ids.join('、')}）：请在 DSH「设置 → 模型」里确认，或重新打开设置页刷新列表`
        : 'DSH 里还没有可用的供应商：请在 DSH「设置 → 模型」里添加一个（需要 baseURL 与至少一个模型）',
    }
  }
  const model = findDshModel(provider, cfg?.dshModel ?? provider.models[0]?.id)
  if (model === undefined) {
    return { ok: false, error: `供应商「${provider.id}」没有模型「${cfg?.dshModel}」（可选：${provider.models.map((m) => m.id).join('、')}）` }
  }
  const target = dshAsrTarget(provider, model.id)
  const apiKey = await resolveDshKey(ctx, target.keyRef)
  if (target.keyRef !== '' && apiKey === undefined) {
    return {
      ok: false,
      error: `供应商「${provider.id}」引用凭据 ${target.keyRef}，但 DSH 凭据库里没有它的值：请在 DSH「设置 → 模型」里为这个供应商填上 API Key（本插件不存这份密钥）`,
    }
  }
  return {
    ok: true,
    baseUrl: target.baseUrl,
    // 备用形态的地址：有些「OpenAI 兼容」端点上根本没有 /audio/transcriptions（实测 Xiaomi
    // MiMo 的 token plan 域名是 404），识别走的是 chat/completions + input_audio 内容块。
    chatUrl: endpointOf(provider.baseUrl, '/chat/completions'),
    model: target.model,
    apiKey: apiKey ?? '',
    keyRef: target.keyRef,
  }
}

// 「这个端点上没有那条路由」：404/405 才值得换一种形态重试。
// 401/403 是凭据问题、400 是参数问题，换形态只会掩盖真正的错因。
export function isMissingRoute(outcome) {
  const status = Number(outcome && outcome.status) || 0
  return status === 404 || status === 405
}

// 两种识别形态的转写文本：/audio/transcriptions 回 {text}，
// chat/completions + input_audio 把转写放在 choices[0].message.content。
export function transcriptOf(outcome) {
  try {
    const payload = JSON.parse((outcome && outcome.body) || '{}')
    if (typeof payload.text === 'string') return payload.text
    const content = payload?.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  } catch { return '' }
}
