# 学习机地 · dsh-study-jidi

[DeepSeek Harness](https://github.com/deepseek-ai) 的侧栏插件：按 **最近发行** 浏览
[jidiyouxi.com（机地）](https://www.jidiyouxi.com/topic/list) 的游戏，点卡片在面板内直接看
游戏信息和下载资源，不用来回切浏览器。

## 功能

- **侧栏入口**：左侧栏「学习机地」一个图标，点开就是游戏列表。
- **五种排序**：最近发行 / 最近更新 / 本周最热 / 本月最热 / 历史最热（自绘下拉框，深色浅色都跟主题）。
- **翻页**：与官网一致的页码导航（`1 2 3 4 5 … 927`），每页 20 款，共一万八千多款。
- **卡片**：Steam 宽幅封面 + 发行日期 + 类型 + 用户标签。
- **面板内详情**：封面、发行日期、平台、类型、发行商、评分、短简介，
  以及每个发布版本的磁力 / 网盘链接：
  - 磁力链接点一下直接写进系统剪贴板（按钮会变成「已复制」），粘到迅雷即可；
  - 网盘链接点一下用系统浏览器打开；
  - 还有游戏截图和完整游戏介绍。
- **缓存**：列表 2 分钟、详情 5 分钟，接口抖动时自动重试并回落到旧缓存。

## 安装

在 DeepSeek Harness 的插件页点 **添加插件**，把下面这行粘进输入框：

```
https://github.com/Kyoma233/dsh-study-jidi
```

装好后侧栏会出现「学习机地」。命令行等价写法：

```bash
dsh plugin add https://github.com/Kyoma233/dsh-study-jidi
```

要求：Node ≥ 20，机器能直连 `github.com` 与 `www.jidiyouxi.com`。

## 工作原理

站点接口虽然带 `access-control-allow-origin: *`，但服务端会校验 `Origin` 并要求 `websign`
签名，浏览器伪造不了，所以签名请求由宿主（Node）发出，面板只读同源路由：

```
Client --- GET /jidi-releases/list?sort=&page= ---> Host
                                                   POST api2.jidiyouxi.com/topic/get_topics
Client --- GET /jidi-releases/detail?id=      ---> Host
                                                   GET www.jidiyouxi.com/topic/detail/<id>
                                                   （解析 SSR 的 window.APP_INITIAL_STATE）
Client --- POST /jidi-releases/copy {text}    ---> Host
                                                   spawn('clip.exe') 写系统剪贴板
```

- **列表签名**：`websign = "v2-" + md5(String(h_m) + md5(JSON.stringify(body) + SALT))`，
  `body` 是实际发出的 JSON（env 段 + 业务段，键顺序即签名顺序），`h_m` 是访客身份 mid。
- **访客身份**：`POST /api/account/register_guest` 现场注册（`h_m:0` 的表单同样要签名），
  拿到 `{mid, token}` 后落在本机 `~/.dsh/study-jidi-identity.json` 复用；遇到 `ret: -11` 自动重新注册。
- **翻页**：第 N 页传 `next_cb = JSON.stringify({offset: (N-1)*20})`，`offset` 恒 0。
- **详情**：`/api/topic/detail` 需要登录态，匿名一律「请求参数错误」，所以改从详情页 HTML 里
  那段 `window.APP_INITIAL_STATE` 里取数据。
- **封面**：站点卡片用的是 Steam 宽幅 `game_info.header_image`（约 310:136），不是方形封面。
- **页码**：站点只在第 1 页返回 `total`，后续页缺总数，宿主按排序记住总数回填。

## 隐私

- 仓库里**没有任何**账号、Cookie、Token、API Key，也没有写死的本机路径。
  唯一的身份是运行时自动注册的匿名访客，只存在你自己的机器上（`~/.dsh/study-jidi-identity.json`）。
- 插件只读站点公开页面与公开接口，不写回任何内容。

## 目录

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主半边：访客身份 + 签名请求 + `/jidi-releases/{list,detail,copy}` 三条路由 + 缓存/重试 |
| `client.js` | 客户端：`sidebar.panellist` 入口 + `main` 面板，列表视图 / 详情视图 |
| `cordis.patch.yml` | 把本包 insert 进 profile |
| `locale/{en,zh}.json`, `icon.svg` | 面板元信息与侧栏图标 |

## 开发

本地改完后需要重装才会生效（改 `index.js` 宿主半边不会热更新）：

```bash
dsh plugin remove dsh-study-jidi
dsh plugin add /absolute/path/to/this/repo
```

## 免责声明

本插件只做浏览和链接展示，游戏信息、下载资源均来自机地网站，版权归原站长与发布者所有。
请自行判断下载内容的安全性。

## License

MIT
