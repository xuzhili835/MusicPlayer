# Sakura Echo 🌸

> 听力 / 播客 / 音乐学习伴侣 —— 声织四季，瓣落成音

![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

Sakura Echo 不只是音乐播放器：它为**语言学习**和**播客收听**而生。把 Bilibili / YouTube 的视频变成可倍速精听的音频，用本地 AI 把音频转成带时间轴的歌词，再配上一键隐私模式——在工位上听什么都安心。

---

## ✨ 功能特性

### 🔒 隐私模式与老板键
- **多键位老板键**：四种动作各自独立绑定全局快捷键（可只绑一个、绑多个或全部不绑），游戏/全屏应用中也能触发：
  - 暂停并全屏遮罩（默认 `F9`）
  - 暂停、遮罩并最小化窗口
  - 继续播放，只遮住屏幕（戴耳机时用）
  - 直接退出应用
- 触发后立即遮罩全部信息（歌曲、歌单、封面、桌面歌词一并隐藏），**遮罩上不显示任何内容提示**，底部仅有低调的退出方法提示（数秒后淡出）
- 遮罩状态下再按任意老板键恢复界面（保持暂停，不会突然出声；"直接退出"除外）
- 内容区头部右侧的**隐私按钮**（与随机播放并排）行为可在设置中选择，`Ctrl+Shift+H` 同效

### 🎧 听力 / 播客播放
- **倍速播放**：0.5x ~ 3x 七档，变速不变调（精听跟读必备）
- **A-B 复读**：设起点/终点区间循环，进度条高亮显示区间，快捷键 `[` `]` `\`
- **睡眠定时**：15/30/60/90 分钟或播完停止
- **随机播放**：洗牌队列，一轮不重复，「上一首」正确回退
- 进度条拖拽 + 悬停时间预览；空格播放暂停、方向键快进退/调音量

### 🎵 内容管理
- 歌单管理：创建/重命名/删除，条目跨歌单管理
- 最近播放历史、搜索、本地文件导入
- 本地导入智能识别标题：自动剥 `【4K Hi-Res】(Official MV)` 等装饰与曲号，按 `艺术家 - 标题` 拆分（内嵌标签优先）

### 📥 音源下载（Bilibili + YouTube）
- 统一入口粘贴链接自动识别（支持 B 站分享文本 / BV号 / YouTube 各种链接格式）
- 内置 yt-dlp + ffmpeg，自动下载最佳音质并转 MP3；自带 B站风控规避（自动领匿名 cookie）
- 下载选项：字幕/歌词开关、下载后自动 AI 转写；**后台下载**（标题栏徽标显示进度，可取消）
- **网络设置**：代理地址（下载 YouTube 必需）、cookies.txt（年龄限制内容）

### 🖊️ 歌词：下载 / AI 转写 / 图片 OCR
- **AI 识别歌词（音频转文字）**：本地 whisper 模型，中/英/日/俄/法/德等 99 种语言自动检测，输出带时间轴 LRC
  - 模型四档规格（75MB ~ 1.5GB，推荐 Base），**由你选择下载**，随时删除释放空间
  - 支持右键单首识别，也支持**批量识别**库里所有无歌词内容（无需重新下载）
- **图片 OCR 导入**：歌词图/课文图拍照导入，调用 Windows 内置 OCR，**零下载零体积**
- 字幕自动下载（B站/YouTube），支持手动编辑保存

### 🔄 自动检查更新
- 启动联网时静默检查 GitHub Releases（仅新版本弹提示），设置内也可手动检查

### 🎚️ 音量同步
- EBU R128 响度分析，自动平衡不同来源的音量差异（B站视频和播客响度差很多？自动拉平）

### 🌙 双主题
- 深色为主（长时间收听护眼），一键切换浅色，樱花粉点缀

### ⌨️ 快捷键

| 按键 | 功能 |
|------|------|
| `F9`（默认，可自定义多键位） | **老板键**：触发绑定的隐私动作 / 恢复界面 |
| `Ctrl+Shift+H` | 隐私模式（应用内，动作同头部隐私按钮） |
| `Space` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 5 秒 |
| `Shift+←` / `Shift+→` | 快退 / 快进 1 秒（精听） |
| `↑` / `↓` | 音量 ±5 |
| `[` / `]` / `\` | A-B 复读：设起点 / 设终点 / 清除 |
| `Ctrl+R` | 刷新界面 |

---

## 📥 安装

### 方式一：直接下载（推荐）

访问 [GitHub Releases](https://github.com/xuzhili835/MusicPlayer/releases) 下载最新版本

- **Sakura Echo Setup 1.2.0.exe** - 安装版（推荐）
- **Sakura Echo-1.2.0-win.zip** - 便携版

### 方式二：从源码运行

```bash
git clone https://github.com/xuzhili835/MusicPlayer.git
cd MusicPlayer
npm install
npm run dev        # 开发运行
npm run build      # 打包
```

---

## 🚀 快速开始

1. **首次启动**：内置 yt-dlp / ffmpeg 会自动就位（约 1~2 分钟），开箱即用
2. **下载音源**：侧边栏「下载音源」→ 粘贴 B站/YouTube 链接 → 自动识别下载
3. **设置老板键**：设置 → 隐私与老板键 → 录制你喜欢的键位 → 「立即体验」试试
4. **AI 歌词**：右键任意条目 → 「AI 识别歌词」→ 首次会引导选择模型规格（推荐 Base）
5. **听力练习**：播放后用倍速 + A-B 复读精听，右键可把内容归类到「听力」

### 下载 YouTube 需要代理？
设置 → 网络与下载 → 填入代理地址（如 `http://127.0.0.1:7890`）。B站一般无需代理。

---

## 🛠️ 技术栈

- **Electron** + 原生 JavaScript（无框架，模块化 mixin 架构）
- **SQLite**（sqlite3）本地数据库
- **yt-dlp / ffmpeg**：下载、转码、响度分析、语音识别预处理
- **whisper.cpp**：本地语音识别（可选下载）
- **Windows OCR**（WinRT）：图片文字识别

## 📁 项目结构

```
├── main.js              # 主进程：窗口/IPC/下载/转写/隐私
├── preload.js           # 上下文桥（安全暴露 API）
├── renderer.js          # 渲染进程核心（装配 mixin）
├── privacy.js           # 隐私模式（渲染端）
├── ocr.js               # 图片 OCR（Windows 内置引擎）
├── lyrics.js            # 歌词：字幕下载/LRC 解析转换
├── database.js          # SQLite 数据层
├── tools-manager.js     # yt-dlp/ffmpeg/whisper 工具与模型管理
├── src/ui/              # 渲染进程功能模块（mixin）
│   ├── player-ui.js     #   播放引擎与播放器 UI
│   ├── library-ui.js    #   库/视图/搜索/分类
│   ├── playlists-ui.js  #   歌单管理
│   ├── download-ui.js   #   下载界面
│   ├── lyrics-ui.js     #   歌词/AI转写/OCR 流程
│   ├── listening-ui.js  #   倍速/A-B/睡眠/随机队列
│   ├── context-menus.js #   右键菜单
│   └── dialogs-ui.js    #   设置等对话框
└── styles.css           # 双主题设计系统
```

## ❓ FAQ

**Q：AI 转写会把我没下载的模型偷偷下下来吗？**
不会。模型必须你在「模型管理」里确认规格并点击下载才会下载，随时可删除。

**Q：图片 OCR 需要装什么吗？**
不需要。使用 Windows 系统内置 OCR 引擎（中文版系统自带）。若提示缺语言包，按引导到系统设置添加即可。

**Q：数据存在哪里？**
音频、歌词、缩略图、数据库都在用户数据目录（`%APPDATA%\sakura-echo`），不污染安装目录。

---

## 📄 License

MIT

## 🙏 致谢

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - 音源下载
- [ffmpeg](https://ffmpeg.org) - 音频处理
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) - 本地语音识别
