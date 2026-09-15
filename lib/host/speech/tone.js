// 语气标签：情绪标记 ⇄ 各 TTS 提供商可识别的插话/风格标签（2026-09-15 从 lib/index.js 拆出）
// 纯函数，不依赖 ctx 与状态。
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
export const MIMO_STYLE_FULL_RE = new RegExp('[（(]\\s*(?:' + MIMO_STYLE_TAGS.join('|') + ')\\s*[)）]', 'gi')
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
export const toneUnreadable = (t, keepStyleTags) => TONE_STRIP.includes(t)
  || (!keepStyleTags && MIMO_STYLE_TAGS.includes(t))
// 括号内是否是可朗读的内容：含汉字/数字（普通括注（明天 9 点）、情绪标记（笑））或
// 已知原生标签 (laughs) 都保留；纯符号串（颜文字 (⁄ ⁄•⁄ω⁄•⁄ ⁄)）整段丢掉。
// 注意方向：判据是「含汉字/数字 ⇒ 保留」，反过来写会把颜文字当成可读内容。
// keepStyleTags=true 时不把 MiMo 风格标签当不可读——MiMo 能演绎它们（见 miMoToneTags）。
export const isReadableToken = (inner, keepStyleTags) => {
  const t = String(inner).trim().toLowerCase()
  if (!t) return false
  if (toneUnreadable(t, keepStyleTags)) return false
  if (TONE_NATIVE.includes(t)) return true
  if (Object.prototype.hasOwnProperty.call(TONE_ALIAS, t)) return true
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(t) || /[0-9]/.test(t)
}
// 只清理不可读内容（emoji 与颜文字），保留发音标记原样——具体标记由各提供商
// 自己的转换函数处理（MiniMax 映射成英文插话标签，MiMo 原样透传）。
export const cleanSpeechSymbols = (s, keepStyleTags) => String(s || '')
  .replace(/[（(][^（）()]{1,24}[)）]/g, (m) => (isReadableToken(m.slice(1, -1), keepStyleTags) ? m : ''))
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
  .replace(/[ \t\u3000]{2,}/g, ' ')
  .replace(/\s+(?=[\u3400-\u9fff\uff00-\uffef])/g, '')
  .replace(/([\u3400-\u9fff\uff00-\uffef])\s+/g, '$1')
  .trim()
// MiniMax：情绪标记 → 英文插话标签；keep=false（speech-02 等旧模型）时全部剥离只读正文
export const convertToneTags = (text, keep) => {
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
export const miMoToneTags = (text, tone) => {
  const s = String(text || '').replace(TONE_DANGLING_RE, '')
  const cleaned = cleanSpeechSymbols(s, true)
  if (tone !== 'strip') return cleaned
  return cleaned.replace(TONE_FULL_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
}
