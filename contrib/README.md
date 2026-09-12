# 把 dsh-voice-call 收录进插件市场（dsh-market）的可见列表

`contrib/biliye__dsh-voice-call.yml` 就是投稿的全部内容：把它复制成
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
仓库里的 `data/plugins/biliye__dsh-voice-call.yml`，开一个 PR 即可。

**不要往 [dsh-market](https://github.com/dsh-market/dsh-market) 提条目 PR**：那个仓库是市场应用本身，
它的条目数据全部来自 awesome-dsh-plugin 这份精选列表（`https://awesome-dsh-plugin.com/plugins.json`）。
市场与 [dshmarket.com](https://dshmarket.com)、[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)
共用同一份数据，所以收录一次，三处同时可见。

## 投稿前：先让 tarball 链接可用（否则先删掉 yml 里那行）

**顺序不能反**：workflow 只有在被打 tag 的那个提交里存在才会运行，所以先把本次改动（根 README、
`package.json`、`.github/workflows/release.yml`、`contrib/`）提交并推送到 `main`，再打 tag。

```sh
git status --short                 # 本次改动已随仓库提交；若你另有改动，先提交它们
git push origin main
git tag v0.2.1 && git push origin v0.2.1     # 触发 .github/workflows/release.yml
```

然后确认链接真的可用再投稿：

```sh
curl -sI https://github.com/biliye/dsh-voice-call/releases/latest/download/dsh-voice-call.tgz | head -1
# 期望：HTTP/2 302（跟随重定向后 200）
```

没打 release 就投稿的话，请先把 `tarball:` 一行删掉——列表不会给用户一个 404 的下载链接，
而收录后再补 release 也不会自动改写已合并的条目。

## 投稿步骤

1. 在 GitHub 上 Fork `awesome-dsh-plugin/awesome-dsh-plugin`（网页点 Fork 即可）。
2. 克隆自己的 fork，新建一条分支，把条目文件放到位（一个文件就是全部投稿）：

   ```sh
   git clone https://github.com/<你的用户名>/awesome-dsh-plugin
   cd awesome-dsh-plugin
   git checkout -b add-dsh-voice-call
   mkdir -p data/plugins
   cp <本仓库>/contrib/biliye__dsh-voice-call.yml data/plugins/biliye__dsh-voice-call.yml
   git add data/plugins/biliye__dsh-voice-call.yml
   git commit -m "Add biliye/dsh-voice-call (voice)"
   git push -u origin add-dsh-voice-call
   ```

3. **不要手工改 README**：`README.md` / `README.zh.md` 由 `data/plugins/*.yml` 生成，
   合并后 CI 会在 `main` 上重跑生成。一个条目文件就是一个 PR，也不会和别人冲突。
4. 在 GitHub 上对 `awesome-dsh-plugin:main` 开 PR，标题例如 `Add biliye/dsh-voice-call (voice)`；
   一个 PR 最多 3 条，本仓库只提 1 条。

> 传输提示（本机 2026-09-12 实测，供本机维护者参考）：
>
> - `api.github.com`、`codeload.github.com` 可**直连**；`github.com` 直连**连接超时**，必须走本机代理。
> - 走代理时该代理对 GitHub 做 TLS 中间人，`git` 用 schannel 与 openssl 两种后端都因证书链不受信而失败
>   （`SSL certificate problem: unable to get local issuer certificate`），直连 `git push` 则报
>   `OpenSSL SSL_read: SSL_ERROR_SYSCALL` 或直接挂住；`git ls-remote` 因直连可读而正常。
> - 所以本机的发布走 **GitHub REST API**（token 需 `repo` + `workflow` 权限）：把本地提交逐字节复刻成远端
>   提交（往返校验 tree/commit SHA 与本地一致），再创建 tag/Release，最后由 tag 触发 workflow 产出附件。
>   本次会话用的脚本在 `.debug/gh-publish.mjs`（`.debug/` 已 gitignore，不入库）。
> - 换到能正常 `git push` 的环境时，上面两条命令仍然适用；本机则需要 API 或修好代理的证书信任。

## 收录条件核对（本仓库现状）

| 条件 | 状态 | 依据 |
|---|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ | `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| 有真实可用的代码 | ✅ | `lib/index.js`(Host) + `lib/client.js`(Client)，非占位仓库 |
| 仓库创建满 1 天 | ✅ | 创建于 2026-08-16（CI 自动检查） |
| 仓库带 `dsh-plugin` topic | ✅ | topics 已含 `dsh-plugin`（另有 `dsh`、`deepseek-harness-plugin`） |
| 描述属实、无营销词 | ✅ | 条目描述逐条对应 README「功能」清单中的实际能力 |
| 分类贴切 | ✅ | `voice`（Voice & Audio），维护者仍可调整，不会因此打回 |

CI 还会跑 `awesome-lint` 与站点构建（双语一致性、分隔符等）。`description.en` 是唯一必填项，
中文缺失由维护者补；本条目中英均已给出，且英文含 `: ` 已按规范加引号。

## 收录后会发生什么

- 合并后夜间构建刷新 `plugins.json`，**通常一天内**出现在市场 Discover 页、`dshmarket.com` 与
  awesome-dsh-plugin.com 的 `voice` 分类，以及每张卡片对应的 GitHub Discussions 讨论帖。
- 市场用户看到的是一个**一键安装**按钮，安装来源即条目里的 `tarball`（无则回退源码构建）。
- dsh-market 卡片的「宿主兼容」标记只在 npm manifest 里读 `engines.dsh` 或 lockstep
  `@deepseek-ai/dsh-*` peer；本仓库目前两者都没声明，因此显示为「未声明」——**不声明不会被隐藏，
  只会没有兼容性结论**。要补的话，请先确认插件在 `0.1.0-rc.6` 起真的能跑，再在 `package.json` 里加：

  ```jsonc
  "engines": { "node": ">=18", "dsh": ">=0.1.0-rc.6 <0.2.0" }
  ```

  市场用 `includePrerelease: true` 求值，所以这个范围能匹配 `0.1.5-rc.1` 这类预发布版本；
  但声明错误会让用户在「只显示兼容插件」的筛选下看不到本插件，所以在验证之前不要写。

## 可选：发布 npm（纯增益，与收录无关）

收录不要求 npm；发布了只是让市场能显示并按下载量排序。发布包的 `repository` 字段必须指回本仓库
（已是），映射由 registry 自动采集，条目里**不要**手写 `npm:` 键——校验会拒绝。

```sh
npm login --registry=https://registry.npmjs.org/   # 必须显式指定：本机默认 registry 是镜像
npm publish                                        # 走 publishConfig.registry，不受本机 registry 影响
```

> ⚠️ 本机踩坑记录（2026-09-12）：`C:\Users\123\.npmrc` 里 `registry=https://registry.npmmirror.com`，
> 而 **npmmirror 是只读镜像、不能发布**。当时 `npm publish --access public` 把包打好了
> （`@biliye/dsh-voice-call@0.2.1`，42.9 kB）却在最后一步中止：
> `ENEEDAUTH: This command requires you to be logged in to https://registry.npmmirror.com`
> ——一个字节都没上传，`registry.npmjs.org` 与 npmmirror 上都是 404。为此 `package.json` 已固定
> `publishConfig.registry = https://registry.npmjs.org/`；但**登录**那一步 `publishConfig` 管不到，
> 仍要显式带 `--registry`，或在 `~/.npmrc` 写 `//registry.npmjs.org/:_authToken=...`。

> 另外两点：
> - scoped 包要求 `@biliye` 这个 scope 归你——npm 用户名就是 `biliye`，或你已创建 `biliye` org；
>   否则要改包名（`package.json` 的 `name` 与 `cordis.patch.yml` 的 row `name` 必须同步改，两者必须一致）。
> - npm 站内**搜索索引有延迟**（几分钟到数小时）。验证请用
>   `https://www.npmjs.com/package/@biliye/dsh-voice-call` 或 `npm view @biliye/dsh-voice-call`，
>   搜不到 ≠ 没发上去。

发布后 ① 号安装方式（`dsh plugin --profile web add @biliye/dsh-voice-call`）才成立，见根 README 的
「📦 安装」。
