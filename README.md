# Sakura Echo 🌸

## 📖 Documentation Available in Multiple Languages
**This README is available in both English and Chinese. Please scroll down or use the navigation links below.**
**本文档提供中英双语版本，请向下滚动或使用下方导航链接。**
**Sakura Echo** is an innovative Electron-based music player that allows you to create a personalized audio library from bilibili(哔哩哔哩) content. By sharing video links from bilibili, the application downloads and converts videos into high-quality audio files, enabling you to build a local music collection.
**Sakura Echo（樱音）** 是一款创新的基于 Electron 的音乐播放器，允许您从 bilibili(哔哩哔哩) 内容创建个性化音频库。通过分享 bilibili 视频链接，应用程序下载并转换视频为高质量音频文件，帮助您构建本地音乐收藏。
[English](#english) | [中文](#chinese)

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)

## 🎵 What is Sakura Echo?

**Sakura Echo** is an innovative Electron-based music player that allows you to create a personalized audio library from bilibili(哔哩哔哩) content. By sharing video links from bilibili, the application downloads and converts videos into high-quality audio files, enabling you to build a local music collection.

**Core Concept**: Sakura Echo serves as a bridge between video content and audio enjoyment, allowing you to discover and organize music from bilibili's diverse ecosystem. The application helps you collect music covers, live performances, original compositions, and other audio content, making them easily accessible in a dedicated music player environment.

**Key Features**:
- 🎯 **Content Discovery**: Easily convert your favorite bilibili videos into audio format
- 🌍 **Local Collection**: Build a personal music library stored on your device
- 💾 **Offline Access**: Enjoy your collected music without internet dependency
- 🎨 **Diverse Content**: Support for various audio content types from bilibili
- 🔧 **User-Friendly Interface**: Modern music player experience with playlist management

## 🚨 Comprehensive Disclaimer and Legal Notice

### Copyright and Intellectual Property
- This software is provided for **educational, research, and personal use only**
- Users must ensure they have proper authorization before downloading any content
- **Strongly recommended**: Only download content from your own bilibili account or content you have explicit permission to use
- Respect intellectual property rights of content creators and copyright holders
- Commercial use of downloaded content may require additional licenses from rights holders

### User Responsibilities
- Users are solely responsible for compliance with local laws and regulations
- Users must respect bilibili's Terms of Service and Community Guidelines
- Any misuse of this software that results in copyright infringement is the user's responsibility
- Users should verify the legal status of content before downloading in their jurisdiction

### Developer Liability Limitations
- The developer is **not responsible** for any copyright infringement, legal violations, or damages caused by software misuse
- This software is provided "as is" without warranties of any kind, express or implied
- The developer does not guarantee the software's functionality, reliability, or suitability for any particular purpose
- Users assume all risks associated with the use of this software

### Data Security and Privacy
- The software operates locally on your device and does not collect personal data
- Downloaded content is stored locally on your device
- Users are responsible for securing their downloaded content and database files
- No user data is transmitted to external servers except for necessary video downloading operations

### Technical Disclaimers
- Software functionality depends on external services (bilibili, yt-dlp, ffmpeg) which may change without notice
- The developer is not responsible for service interruptions or compatibility issues
- Regular updates may be required to maintain functionality
- Some features may not work as expected due to external dependencies

### Legal Compliance
- This software is not affiliated with, endorsed by, or sponsored by bilibili
- Users must comply with all applicable laws in their jurisdiction
- If you are a copyright holder and believe your rights have been infringed, please contact the relevant parties directly
- This disclaimer does not limit users' rights under applicable consumer protection laws

---

<a name="english"></a>
## 🌸 Sakura Echo (English Version)

### ✨ Features

#### 🎵 Music Playback
- **High-quality audio playback** - Supports multiple audio formats
- **Playback modes** - Sequential, reverse, random, single loop
- **Volume control** - Precise volume adjustment and mute
- **Progress control** - Draggable progress bar

#### 📺 bilibili(哔哩哔哩) Video Download
- **Video to audio conversion** - Extract high-quality audio from bilibili videos
- **Smart download** - Automatically selects the best audio quality
- **Built-in tools** - Includes yt-dlp and ffmpeg, ready to use out of the box

#### 📂 Playlist Management
- **Create playlists** - Custom playlists for flexible music organization
- **Edit playlists** - Rename playlists, add/remove songs
- **Song management** - Move songs between playlists
- **Count display** - Real-time display of song count in playlists

#### 💾 Local Music
- **File import** - Import local music files
- **Directory scanning** - Batch scan directories to add music
- **Metadata extraction** - Automatically extract song title, artist and other information

#### 🖥️ User Interface
- **Modern design** - Clean and elegant user interface
- **Responsive layout** - Adapts to different screen sizes
- **Right-click menu** - Rich right-click operation menu

### 🚀 Quick Start

#### System Requirements
- **Operating System**: Windows 10+ (Currently Windows only)
- **Memory**: At least 512MB RAM
- **Storage**: 500MB available space

#### Installation
1. Go to Releases page
2. Download `Sakura Echo Setup 1.0.0.exe`
3. Run the installer and follow the prompts

#### Build from Source
```bash
# Clone repository
git clone https://github.com/xuzhili835/Sakura-Echo.git
cd Sakura-Echo

# Install dependencies
npm install

# Run development version
npm run dev

# Build production version
npm run build
```

### 📖 Detailed Usage Guide

#### First Time Setup
1. **Launch the application** - Double-click the desktop icon or launch from start menu
2. **Add music** - You can add music in the following ways:
   - Paste bilibili(哔哩哔哩) video links for download
   - Click "Add Local Music" to import local files
   - Use "Scan Directory" to batch add music
3. **Create playlists** - Right-click on the sidebar to create custom playlists
4. **Start enjoying** - Double-click a song to start playback

#### bilibili(哔哩哔哩) Video Download
1. **Copy video link** - Copy the bilibili video URL (supports both b23.tv short links and full URLs)
2. **Download in application** - Click the download button in the application
3. **Paste and confirm** - Paste the link and click confirm
4. **Automatic processing** - The application will automatically download the video and convert it to audio format
5. **Auto-add to library** - After conversion, the song will be automatically added to your music library

#### Playlist Management
- **Create playlist** - Right-click on the sidebar blank area and select "Create Playlist"
- **Add songs** - Right-click on songs and select "Add to Playlist"
- **Edit playlist** - Right-click on playlists for options like rename, delete, etc.
- **🎯 Modify song info** - **Important**: Right-click on songs to edit title and artist information. Since bilibili video titles often don't match the actual song names and artists, this feature allows you to correct and organize your music library with accurate metadata

#### Playback Controls
- **Basic controls** - Play/Pause, Previous/Next track
- **Playback modes** - Sequential, Reverse, Random, Single Loop
- **Volume control** - Adjust volume with the volume slider
- **Progress control** - Click or drag the progress bar to jump to specific positions

### ⚠️ Important Notes

#### Known Issues

**🚨 Critical Bug - Delete Operations**

After any delete operations (deleting songs, playlists, etc.), you **MUST manually switch screens** (alt+tab) to refresh the interface. Otherwise, the input fields may become unresponsive and the interface may freeze.

#### Desktop Lyrics Issues
The desktop lyrics feature has some known issues:
- May not be draggable
- Close button may not work properly
- Exiting the application without closing lyrics window may cause the lyrics to remain stuck on screen

#### Current Limitations
- **Platform support** - Currently Windows only
- **Video platforms** - Only supports bilibili(哔哩哔哩), YouTube and other platforms are not yet supported
- **Lyrics feature** - Automatic lyrics extraction is not yet implemented

### 🛠️ Tech Stack
- **Framework**: [Electron](https://electronjs.org/) - Cross-platform desktop application framework
- **Frontend**: HTML5 + CSS3 + JavaScript
- **Database**: [SQLite](https://www.sqlite.org/) - Lightweight local database
- **Audio Processing**: HTML5 Audio API
- **Download Tool**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Video download tool
- **Audio Conversion**: [FFmpeg](https://ffmpeg.org/) - Multimedia processing tool

### 📁 Project Structure
```
Sakura-Echo/
├── main.js                 # Electron main process
├── renderer.js             # Renderer process logic
├── preload.js              # Preload script
├── index.html              # Main interface
├── styles.css              # Style files
├── database.js             # Database operations
├── lyrics.js               # Lyrics processing
├── tools-manager.js        # Tool management
├── icons.js                # Icon management
├── bin/                    # External tools (yt-dlp, ffmpeg)
├── build/                  # Build resources
├── music/                  # Music file storage
├── lyrics/                 # Lyrics file storage
├── thumbnails/             # Thumbnail storage
└── package.json            # Project configuration
```

### 🔧 Development

#### Development Environment Setup
```bash
# Install development dependencies
npm install

# Start development mode
npm run dev

# Build application
npm run build
```

#### Build Instructions
```bash
# Build Windows version
npm run build

# Package only (no installer)
npm run dist
```

#### Contributing
1. Fork this repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### 📝 Changelog

#### v1.0.0
- 🎉 First release
- ✨ Support for bilibili(哔哩哔哩) video download and conversion
- ✨ Complete playlist management system
- ✨ Local music import functionality
- ✨ Built-in yt-dlp and ffmpeg tools
- 🎨 Modern user interface

### ❓ FAQ

#### Q: What's the audio quality of downloaded files?
A: The application automatically selects the highest audio quality available from bilibili, typically 128kbps or higher.

#### Q: What audio formats are supported?
A: Primarily supports MP3 format, and also supports importing common audio formats like WAV, FLAC, etc.

#### Q: How do I backup my playlists?
A: Playlist data is stored in the `music.db` file. Back up this file to save all playlist information.

#### Q: Do I need to install yt-dlp and ffmpeg separately?
A: No, the application includes built-in yt-dlp and ffmpeg tools, ready to use out of the box.

### 📄 License
This project is open sourced under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments
- [Electron](https://electronjs.org/) - Cross-platform desktop application framework
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Powerful video download tool
- [FFmpeg](https://ffmpeg.org/) - Excellent multimedia processing tool

---

<a name="chinese"></a>
## 🌸 樱音 (中文版)

## 🎵 什么是 Sakura Echo？

**Sakura Echo（樱音）** 是一款创新的基于 Electron 的音乐播放器，允许您从 bilibili(哔哩哔哩) 内容创建个性化音频库。通过分享 bilibili 视频链接，应用程序下载并转换视频为高质量音频文件，帮助您构建本地音乐收藏。

**核心理念**：Sakura Echo 作为视频内容与音频享受之间的桥梁，让您能够发现和整理来自 bilibili 多元化生态系统的音乐。该应用帮助您收集音乐翻唱、现场表演、原创作品和其他音频内容，使它们在专用的音乐播放器环境中轻松访问。

**核心功能**：
- 🎯 **内容发现**：轻松将您喜爱的 bilibili 视频转换为音频格式
- 🌍 **本地收藏**：构建存储在您设备上的个人音乐库
- 💾 **离线访问**：无需网络依赖即可享受您收藏的音乐
- 🎨 **多样化内容**：支持来自 bilibili 的各种音频内容类型
- 🔧 **用户友好界面**：具有歌单管理功能的现代音乐播放器体验

## 🚨 全面免责申明和法律声明

### 版权和知识产权
- 本软件仅供**教育、研究和个人使用**
- 用户必须确保在下载任何内容之前拥有适当的授权
- **强烈建议**：仅下载您自己 bilibili 账户中的内容或您有明确许可使用的内容
- 尊重内容创作者和版权持有者的知识产权
- 下载内容的商业使用可能需要权利持有者的额外许可

### 用户责任
- 用户对遵守当地法律法规负全责
- 用户必须遵守 bilibili 的服务条款和社区准则
- 因软件误用导致的任何版权侵权行为由用户承担责任
- 用户应在其管辖范围内验证内容的合法状态后再下载

### 开发者责任限制
- 开发者**不对**因软件误用导致的任何版权侵权、法律违规或损害负责
- 本软件按"现状"提供，不提供任何明示或暗示的保证
- 开发者不保证软件的功能性、可靠性或对任何特定目的的适用性
- 用户承担与使用本软件相关的所有风险

### 数据安全和隐私
- 软件在您的设备上本地运行，不收集个人数据
- 下载的内容存储在您的设备本地
- 用户负责保护其下载的内容和数据库文件
- 除必要的视频下载操作外，不会向外部服务器传输用户数据

### 技术免责
- 软件功能依赖于外部服务（bilibili、yt-dlp、ffmpeg），这些服务可能在不通知的情况下发生变化
- 开发者不对服务中断或兼容性问题负责
- 可能需要定期更新以维持功能性
- 由于外部依赖，某些功能可能无法按预期工作

### 法律合规
- 本软件与 bilibili 无关联、不受其认可或赞助
- 用户必须遵守其管辖范围内的所有适用法律
- 如果您是版权持有者并认为您的权利受到侵犯，请直接联系相关方
- 本免责声明不限制用户在适用消费者保护法律下的权利

### ✨ 功能特性

#### 🎵 音乐播放
- **高质量音频播放** - 支持多种音频格式
- **播放模式** - 顺序、倒序、随机、单曲循环
- **音量控制** - 精确的音量调节和静音功能
- **进度控制** - 可拖拽的进度条

#### 📺 bilibili(哔哩哔哩)视频下载
- **视频转音频** - 从bilibili(哔哩哔哩)视频提取高质量音频
- **智能下载** - 自动选择最佳音质
- **内置工具** - 内置 yt-dlp 和 ffmpeg 工具，开箱即用

#### 📂 歌单管理
- **创建歌单** - 创建自定义歌单，灵活分类管理
- **歌单编辑** - 重命名歌单、添加/移除歌曲
- **歌曲管理** - 在不同歌单间移动歌曲
- **计数显示** - 实时显示歌单中歌曲数量

#### 💾 本地音乐
- **文件导入** - 导入本地音乐文件
- **目录扫描** - 批量扫描目录添加音乐
- **元数据提取** - 自动提取歌曲标题、艺术家等信息

#### 🖥️ 用户界面
- **现代化设计** - 简洁优雅的用户界面
- **响应式布局** - 适配不同屏幕尺寸
- **右键菜单** - 丰富的右键操作菜单

### 🚀 快速开始

#### 系统要求
- **操作系统**: Windows 10+（目前仅支持Windows）
- **内存**: 最少 512MB RAM
- **存储**: 500MB 可用空间

#### 安装说明
1. 前往 Releases 页面
2. 下载 `Sakura Echo Setup 1.0.0.exe`
3. 运行安装程序并按照提示完成安装

#### 从源码构建
```bash
# 克隆仓库
git clone https://github.com/xuzhili835/Sakura-Echo.git
cd Sakura-Echo

# 安装依赖
npm install

# 运行开发版本
npm run dev

# 构建生产版本
npm run build
```

### 📖 详细使用指南

#### 首次使用
1. **启动应用** - 双击桌面图标或从开始菜单启动
2. **添加音乐** - 通过以下方式添加音乐：
   - 粘贴bilibili(哔哩哔哩)视频链接进行下载
   - 点击"添加本地音乐"导入本地文件
   - 使用"扫描目录"批量添加音乐
3. **创建歌单** - 右键侧边栏创建自定义歌单
4. **开始享受** - 双击歌曲开始播放

#### bilibili(哔哩哔哩)视频下载
1. **复制视频链接** - 复制bilibili(哔哩哔哩)视频链接（支持 b23.tv 短链接和完整URL）
2. **在应用中下载** - 点击应用中的下载按钮
3. **粘贴并确认** - 粘贴链接并点击确认
4. **自动处理** - 应用将自动下载视频并转换为音频格式
5. **自动添加到音乐库** - 转换完成后歌曲将自动添加到音乐库

#### 歌单管理
- **创建歌单** - 右键侧边栏空白处选择"创建歌单"
- **添加歌曲** - 右键歌曲选择"添加到歌单"
- **编辑歌单** - 右键歌单可进行重命名、删除等操作
- **🎯 修改歌曲信息** - **重要功能**：右键歌曲可编辑标题和艺术家信息。由于 bilibili 视频标题通常与实际歌曲名称和艺术家不符，此功能允许您使用准确的元数据来纠正和整理音乐库

#### 播放控制
- **基本控制** - 播放/暂停、上一首/下一首
- **播放模式** - 顺序播放、倒序播放、随机播放、单曲循环
- **音量控制** - 使用音量滑块调节音量
- **进度控制** - 点击或拖拽进度条跳转到指定位置

### ⚠️ 重要注意事项

#### 已知问题

**🚨 严重Bug - 删除操作**

执行任何删除操作（删除歌曲、歌单等）后，**必须手动切屏**（alt+tab）来刷新界面，否则输入栏可能会卡死，界面可能会冻结。

#### 桌面歌词问题
桌面歌词功能存在一些已知问题：
- 可能无法拖动
- 关闭按钮可能无法正常工作
- 不关闭歌词窗口直接退出应用可能导致歌词界面卡在屏幕上

#### 当前限制
- **平台支持** - 目前仅支持 Windows
- **视频平台** - 仅支持bilibili(哔哩哔哩)，暂不支持YouTube等其他平台
- **歌词功能** - 自动歌词提取功能尚未实现

### 🛠️ 技术栈
- **框架**: [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- **前端**: HTML5 + CSS3 + JavaScript
- **数据库**: [SQLite](https://www.sqlite.org/) - 轻量级本地数据库
- **音频处理**: HTML5 Audio API
- **下载工具**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) - 视频下载工具
- **音频转换**: [FFmpeg](https://ffmpeg.org/) - 多媒体处理工具

### 📁 项目结构
```
Sakura-Echo/
├── main.js                 # Electron 主进程
├── renderer.js             # 渲染进程逻辑
├── preload.js              # 预加载脚本
├── index.html              # 主界面
├── styles.css              # 样式文件
├── database.js             # 数据库操作
├── lyrics.js               # 歌词处理
├── tools-manager.js        # 工具管理
├── icons.js                # 图标管理
├── bin/                    # 外部工具 (yt-dlp, ffmpeg)
├── build/                  # 构建资源
├── music/                  # 音乐文件存储
├── lyrics/                 # 歌词文件存储
├── thumbnails/             # 缩略图存储
└── package.json            # 项目配置
```

### 🔧 开发说明

#### 开发环境设置
```bash
# 安装开发依赖
npm install

# 启动开发模式
npm run dev

# 构建应用
npm run build
```

#### 构建说明
```bash
# 构建 Windows 版本
npm run build

# 仅打包不安装
npm run dist
```

#### 贡献指南
1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 Pull Request

### 📝 更新日志

#### v1.0.0
- 🎉 首次发布
- ✨ 支持bilibili(哔哩哔哩)视频下载转换
- ✨ 完整的歌单管理系统
- ✨ 本地音乐导入功能
- ✨ 内置 yt-dlp 和 ffmpeg 工具
- 🎨 现代化用户界面

### ❓ 常见问题

#### Q: 下载的音频质量如何？
A: 应用会自动选择bilibili(哔哩哔哩)提供的最高音质进行下载，通常为 128kbps 或更高。

#### Q: 支持哪些音频格式？
A: 主要支持 MP3 格式，同时支持导入常见的音频格式如 WAV、FLAC 等。

#### Q: 如何备份我的歌单？
A: 歌单数据存储在 `music.db` 文件中，备份此文件即可保存所有歌单信息。

#### Q: 需要单独安装 yt-dlp 和 ffmpeg 吗？
A: 不需要，应用内置了 yt-dlp 和 ffmpeg 工具，开箱即用。

### 📄 许可证
本项目基于 MIT 许可证开源 - 查看 [LICENSE](LICENSE) 文件了解详情。

### 🙏 致谢
- [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - 强大的视频下载工具
- [FFmpeg](https://ffmpeg.org/) - 优秀的多媒体处理工具

---

## 🌸 Sakura Echo - 声织四季，瓣落成音

<div align="center">

**English**: A music player that weaves seasons with sound, where petals fall into melodies.

**中文**: 一个音乐播放器，声织四季，瓣落成音。

---

**If this project helps you, please consider giving it a ⭐ to show your support!**  
**如果这个项目对您有帮助，请考虑给个 ⭐ 支持一下！**

Made with ❤️ by [xuzhili835](https://github.com/xuzhili835)

</div> 
