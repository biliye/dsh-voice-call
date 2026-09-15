// 导演模式指令块：解析「指令 + --- + 正文」的结构（2026-09-15 从 lib/index.js 拆出）
// 纯函数，只依赖 tone.js 的风格标签表。
import { MIMO_STYLE_FULL_RE } from './tone.js'

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
export const isDashLine = (line) => /^-{3,}$/.test(String(line || '').trim())
// 解析不出结构时返回 null——调用方必须降级为「无导演指令」而不是把整段当正文送去朗读，
// 否则会把【角色】【场景】【指导】逐字念给用户听。
export const parseDirectorBlock = (text) => {
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
export const hasDirectorResidue = (s) => String(s || '').split(/\r?\n/)
  .some((line) => DIRECTOR_MARKERS.some((mk) => mk.re.test(line.trim())))
// 正文里可能要剥掉的 MiMo 风格标签：这些是 MiMo 原生标签，对 MiniMax / OpenAI 兼容端点
// 没有对应实现，换端点朗读时必须删掉，否则会被逐字念成「东北话」。
// 朗读提供商与生成回复所用的提供商是两件事，不能混为一谈。
export const stripStyleTags = (s) => String(s || '').replace(MIMO_STYLE_FULL_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
