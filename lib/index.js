// @linxin666/dsh-voice-call — Host half
// 语音通话助手：专属工作区/会话（自动创建、跨重启保持）、任务分发（子代理会话）、
// 语音文本注入、TTS/云端 ASR 中转、主动进度检查、voice_task 动态工具、voiceAssistant 联动服务。
//
// 2026-09-15 结构拆分：实现全部移入 lib/host/**（装配层为 host/plugin.js）。
// 本文件只保留 DSH 插件入口契约 name / inject / apply，
// package.json 的 main / exports 与安装方式（含 junction 直装）都未改变。
export { name, inject } from './host/config.js'
export { apply } from './host/plugin.js'
