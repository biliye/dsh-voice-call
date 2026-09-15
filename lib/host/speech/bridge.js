// node 子进程网络桥 + 各提供商子进程脚本（2026-09-15 从 lib/index.js 拆出）
// payload 通过 stdin 传入（Windows 命令行长度限制 ~32KB，音频 base64 会超，
// argv 传 JSON 会 spawn ENAMETOOLONG）。
export function createBridge(ctx) {
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
  return { runNode, TTS_MINIMAX, TTS_OPENAI, TTS_MIMO, ASR_OPENAI }
}
