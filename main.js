const { app, BrowserWindow, ipcMain, dialog, shell, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');
const { parseFile } = require('music-metadata');
const Database = require('./database.js');
const LyricsManager = require('./lyrics.js');
const ToolsManager = require('./tools-manager.js');
const OcrManager = require('./ocr.js');

class BiliMusicPlayer {
    constructor() {
        this.mainWindow = null;
        this.lyricsWindow = null;
        this.database = new Database();
        this.isQuitting = false;
        
        // 设置应用路径 - 使用用户数据目录而不是应用目录
        const userDataPath = app.getPath('userData');
        this.musicDir = path.join(userDataPath, 'music');
        this.tempDir = path.join(userDataPath, 'temp_downloads');
        this.thumbnailsDir = path.join(userDataPath, 'thumbnails');
        this.lyricsDir = path.join(userDataPath, 'lyrics');
        
        // 初始化歌词管理器，传入正确的路径和工具管理器（解析 yt-dlp 路径）
        this.toolsManager = new ToolsManager();
        this.lyricsManager = new LyricsManager(this.lyricsDir, this.tempDir, this.toolsManager);

        // 初始化 OCR 管理器（Windows 内置 OCR，零依赖）
        this.ocrManager = new OcrManager(userDataPath);

        // 下载进程追踪（用于取消下载）
        this.downloadProcesses = new Set();
        this.downloadCancelRequested = false;
        this.downloadInProgress = false; // 单任务锁：同时只允许一个下载任务

        // 隐私模式（老板键）
        this.privacyActive = false;
        this.lyricsWindowWasVisible = false; // 进入隐私模式时桌面歌词窗口是否可见
        this.privacySettings = {
            enabled: true,
            accelerator: 'F9',      // 老板键默认键位
            action: 'overlay'       // 'overlay' | 'overlay_minimize'
        };
        
        console.log('音乐目录:', this.musicDir);
        console.log('临时目录:', this.tempDir);
        console.log('缩略图目录:', this.thumbnailsDir);
        console.log('歌词目录:', this.lyricsDir);
        
        this.initializeApp();
    }

    // 初始化应用
    initializeApp() {
        app.whenReady().then(async () => {
            // 禁用默认菜单栏
            Menu.setApplicationMenu(null);
            
            await this.ensureDirectories();
            await this.database.initialize();
            
            // 设置工具（检查并下载必要的工具）
            await this.setupTools();

            this.createMainWindow();
            this.setupIPC();
            await this.initPrivacy();
            this.scheduleUpdateCheck();

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    this.createMainWindow();
                }
            });
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                this.isQuitting = true;
                
                // 强制关闭歌词窗口
                if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                    this.lyricsWindow.destroy();
                    this.lyricsWindow = null;
                }
                
                this.cleanup().then(() => {
                    app.quit();
                }).catch((error) => {
                    console.error('清理失败，强制退出:', error);
                    // 强制关闭所有窗口
                    BrowserWindow.getAllWindows().forEach(window => {
                        if (!window.isDestroyed()) {
                            window.destroy();
                        }
                    });
                    app.quit();
                });
            }
        });

        app.on('before-quit', async (event) => {
            if (!this.isQuitting) {
                event.preventDefault();
                this.isQuitting = true;
                
                try {
                    // 强制关闭歌词窗口
                    if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                        this.lyricsWindow.destroy();
                        this.lyricsWindow = null;
                    }
                    
                    await this.cleanup();
                    app.quit();
                } catch (error) {
                    console.error('清理失败，强制退出:', error);
                    // 强制关闭所有窗口
                    BrowserWindow.getAllWindows().forEach(window => {
                        if (!window.isDestroyed()) {
                            window.destroy();
                        }
                    });
                    app.quit();
                }
            }
        });

        // 处理强制退出
        app.on('will-quit', () => {
            // 注销所有全局快捷键（老板键）
            try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ }
            console.log('应用正在退出...');
        });
    }

    // ==================== 隐私模式（老板键） ====================

    // 初始化隐私模式：加载设置并注册全局快捷键
    async initPrivacy() {
        try {
            const saved = await this.database.getSetting('privacy_settings', null);
            if (saved && typeof saved === 'object') {
                this.privacySettings = { ...this.privacySettings, ...saved };
            }

            const ok = this.applyPrivacyShortcut();
            if (!ok && this.mainWindow) {
                this.mainWindow.webContents.send('privacy-shortcut-error', {
                    message: `老板键 ${this.privacySettings.accelerator} 注册失败（可能被其他程序占用），可在设置中修改键位`
                });
            }
        } catch (error) {
            console.error('初始化隐私模式失败:', error);
        }
    }

    // 注册/重新注册老板键全局快捷键，返回是否成功
    applyPrivacyShortcut() {
        try {
            // 先清掉旧注册
            try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ }

            if (!this.privacySettings.enabled) {
                return true;
            }

            const accelerator = this.privacySettings.accelerator || 'F9';
            const ok = globalShortcut.register(accelerator, () => this.togglePrivacy());
            if (!ok) {
                console.warn(`老板键 ${accelerator} 注册失败`);
            }
            return ok;
        } catch (error) {
            console.error('注册老板键失败:', error);
            return false;
        }
    }

    // 切换隐私模式
    togglePrivacy() {
        this.privacyActive = !this.privacyActive;
        this.applyPrivacyState();
    }

    // 应用隐私状态到所有窗口
    applyPrivacyState() {
        const active = this.privacyActive;

        // 主窗口：通知渲染进程（暂停播放 + 全屏遮罩），附带键位用于显示退出提示
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('privacy-state-changed', {
                active,
                accelerator: this.privacySettings.enabled ? this.privacySettings.accelerator : null
            });
        }

        // 桌面歌词窗口：进入隐私时隐藏，退出时恢复
        if (active) {
            this.lyricsWindowWasVisible = !!(
                this.lyricsWindow && !this.lyricsWindow.isDestroyed() && this.lyricsWindow.isVisible()
            );
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed() && this.lyricsWindow.isVisible()) {
                this.lyricsWindow.hide();
            }
        } else if (this.lyricsWindow && !this.lyricsWindow.isDestroyed() && this.lyricsWindowWasVisible) {
            this.lyricsWindow.show();
            this.lyricsWindowWasVisible = false;
        }

        // 可选：触发后最小化窗口
        if (active && this.privacySettings.action === 'overlay_minimize' &&
            this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.minimize();
        }
    }
    
    // 设置工具
    async setupTools() {
        try {
            console.log('开始设置工具...');
            
            // 首先进行二进制文件验证
            const binaryValidation = await this.validateBinaries();
            if (binaryValidation.hasIssues) {
                console.warn('发现二进制文件问题:', binaryValidation.issues);
                // 发送到渲染进程显示警告
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('binary-validation-warning', binaryValidation);
                }
            }
            
            const results = await this.toolsManager.setupTools((tool, progress, downloaded, total) => {
                console.log(`${tool} 下载进度: ${progress.toFixed(1)}% (${downloaded}/${total})`);
                
                // 可以发送进度到渲染进程
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('tool-download-progress', {
                        tool,
                        progress,
                        downloaded,
                        total
                    });
                }
            });
            
            console.log('工具设置结果:', results);
            
            // 检查是否有失败的工具
            const failedTools = Object.entries(results)
                .filter(([tool, status]) => status === 'failed')
                .map(([tool]) => tool);
            
            if (failedTools.length > 0) {
                console.warn(`以下工具设置失败: ${failedTools.join(', ')}`);
                
                // 对失败的工具进行诊断
                for (const tool of failedTools) {
                    const diagnosis = await this.toolsManager.diagnoseToolStatus(tool);
                    console.error(`${tool} 诊断结果:`, diagnosis);
                    
                    // 发送诊断结果到渲染进程
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('tool-diagnosis', { tool, diagnosis });
                    }
                }
                
                // 如果ffmpeg设置失败，显示特殊错误
                if (failedTools.includes('ffmpeg')) {
                    const errorMessage = 'ffmpeg工具不可用。请打开"检查控制台"并点击"强制重新下载工具"按钮，然后重试。';
                    console.error(errorMessage);
                    
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('ffmpeg-error', { message: errorMessage });
                    }
                }
            }
            
            // 发送工具设置完成事件
            if (this.mainWindow) {
                this.mainWindow.webContents.send('tools-setup-complete', results);
            }
            
        } catch (error) {
            console.error('设置工具失败:', error);
            
            // 发送错误到渲染进程
            if (this.mainWindow) {
                this.mainWindow.webContents.send('tools-setup-error', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }
    }

    // 验证二进制文件
    async validateBinaries() {
        const validation = {
            hasIssues: false,
            issues: [],
            recommendations: [],
            binaries: {}
        };
        
        try {
            const binaries = ['ffmpeg', 'ffprobe'];
            
            for (const binary of binaries) {
                const binaryInfo = {
                    name: binary,
                    available: false,
                    path: null,
                    size: 0,
                    source: null // 'app', 'user', 'system'
                };
                
                try {
                    // 检查应用bin目录
                    const paths = this.toolsManager.getToolPath(binary);
                    if (paths) {
                        try {
                            await fs.access(paths.app);
                            const stats = await fs.stat(paths.app);
                            
                            if (stats.size > 1024 * 1024) { // 大于1MB才认为是有效的
                                binaryInfo.available = true;
                                binaryInfo.path = paths.app;
                                binaryInfo.size = stats.size;
                                binaryInfo.source = 'app';
                            } else {
                                validation.hasIssues = true;
                                validation.issues.push(`应用bin目录中的${binary}文件大小异常: ${stats.size} bytes`);
                            }
                        } catch (error) {
                            // 应用bin目录中没有，这是正常的
                        }
                    }
                    
                    // 如果应用bin目录中没有，检查用户bin目录
                    if (!binaryInfo.available) {
                        const userToolPath = await this.toolsManager.getAvailableToolPath(binary);
                        if (userToolPath) {
                            const stats = await fs.stat(userToolPath);
                            binaryInfo.available = true;
                            binaryInfo.path = userToolPath;
                            binaryInfo.size = stats.size;
                            binaryInfo.source = 'user';
                        }
                    }
                    
                    // 最后检查系统工具
                    if (!binaryInfo.available) {
                        if (await this.toolsManager.isSystemToolAvailable(binary)) {
                            binaryInfo.available = true;
                            binaryInfo.path = binary;
                            binaryInfo.source = 'system';
                        }
                    }
                    
                    if (!binaryInfo.available) {
                        validation.hasIssues = true;
                        validation.issues.push(`${binary}工具不可用`);
                        validation.recommendations.push(`需要下载${binary}工具`);
                    }
                    
                } catch (error) {
                    validation.hasIssues = true;
                    validation.issues.push(`检查${binary}时出错: ${error.message}`);
                }
                
                validation.binaries[binary] = binaryInfo;
            }
            
            return validation;
            
        } catch (error) {
            validation.hasIssues = true;
            validation.issues.push(`二进制文件验证过程中出错: ${error.message}`);
            return validation;
        }
    }

    // 确保目录存在
    async ensureDirectories() {
        try {
            await fs.mkdir(this.musicDir, { recursive: true });
            await fs.mkdir(this.tempDir, { recursive: true });
            await fs.mkdir(this.thumbnailsDir, { recursive: true });
            await fs.mkdir(this.lyricsDir, { recursive: true });
            
            // 迁移现有数据
            await this.migrateExistingData();
            
            console.log('目录初始化完成');
        } catch (error) {
            console.error('目录初始化失败:', error);
        }
    }

    // 迁移现有数据
    async migrateExistingData() {
        try {
            console.log('开始检查数据迁移...');
            
            // 检查应用目录中是否有现有的音乐文件
            const oldMusicDir = path.join(__dirname, 'music');
            const oldThumbnailsDir = path.join(__dirname, 'thumbnails');
            const oldLyricsDir = path.join(__dirname, 'lyrics');
            
            // 迁移音乐文件
            if (fsSync.existsSync(oldMusicDir)) {
                console.log('发现现有音乐文件，开始迁移...');
                await this.copyDirectoryIfNotExists(oldMusicDir, this.musicDir);
            }
            
            // 迁移缩略图
            if (fsSync.existsSync(oldThumbnailsDir)) {
                console.log('发现现有缩略图，开始迁移...');
                await this.copyDirectoryIfNotExists(oldThumbnailsDir, this.thumbnailsDir);
            }
            
            // 迁移歌词文件
            if (fsSync.existsSync(oldLyricsDir)) {
                console.log('发现现有歌词文件，开始迁移...');
                await this.copyDirectoryIfNotExists(oldLyricsDir, this.lyricsDir);
            }
            
            console.log('数据迁移检查完成');
        } catch (error) {
            console.error('数据迁移失败:', error);
            // 继续执行，不阻止应用启动
        }
    }

    // 复制目录（如果目标不存在）
    async copyDirectoryIfNotExists(srcDir, destDir) {
        try {
            // 确保目标目录存在
            await fs.mkdir(destDir, { recursive: true });
            
            const files = await fs.readdir(srcDir);
            let copiedCount = 0;
            
            for (const file of files) {
                const srcFile = path.join(srcDir, file);
                const destFile = path.join(destDir, file);
                
                // 如果目标文件不存在，则复制
                if (!await this.fileExists(destFile)) {
                    const stat = await fs.stat(srcFile);
                    if (stat.isFile()) {
                        await fs.copyFile(srcFile, destFile);
                        copiedCount++;
                    }
                }
            }
            
            if (copiedCount > 0) {
                console.log(`迁移了 ${copiedCount} 个文件从 ${srcDir} 到 ${destDir}`);
            }
        } catch (error) {
            console.log(`复制目录失败: ${error.message}`);
        }
    }

    // 创建主窗口
    createMainWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            frame: false, // 无系统标题栏（应用自绘标题栏，避免出现两排窗口控制按钮和白边）
            // Windows 下 thickFrame 默认为 true，保留系统阴影与边缘拖拽调整大小
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            title: 'Sakura Echo - 声织四季，瓣落成音',
            show: false,
            backgroundColor: '#0e1014' // 防止启动瞬间白闪（与深色主题背景一致）
        });

        // 加载HTML文件
        this.mainWindow.loadFile('index.html');

        // 窗口准备显示时显示
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
        });

        // 窗口关闭时
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
            // 关闭歌词窗口
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                this.lyricsWindow.destroy();
                this.lyricsWindow = null;
            }
        });

        // 开发环境下打开开发者工具
        if (process.env.NODE_ENV === 'development') {
            this.mainWindow.webContents.openDevTools();
        }
    }

    // 创建桌面歌词窗口
    createLyricsWindow() {
        if (this.lyricsWindow) {
            this.lyricsWindow.focus();
            return;
        }

        this.lyricsWindow = new BrowserWindow({
            width: 800,
            height: 120,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            skipTaskbar: true
        });

        // 加载歌词窗口HTML（简单的歌词显示页面）
        this.lyricsWindow.loadURL(`data:text/html;charset=utf-8,
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        margin: 0;
                        padding: 10px 20px;
                        font-family: Arial, sans-serif;
                        color: white;
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
                        background: rgba(0,0,0,0.3);
                        text-align: center;
                        user-select: none;
                        position: relative;
                        border-radius: 8px;
                        backdrop-filter: blur(10px);
                    }
                    .lyrics-container {
                        cursor: move;
                        padding: 10px 0;
                    }
                    .lyrics {
                        font-size: 24px;
                        line-height: 1.5;
                    }
                    .close-btn {
                        position: absolute;
                        top: 5px;
                        right: 8px;
                        width: 20px;
                        height: 20px;
                        border-radius: 50%;
                        background: rgba(255,255,255,0.2);
                        border: none;
                        color: white;
                        font-size: 14px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.3s ease;
                        opacity: 0;
                    }
                    .close-btn:hover {
                        background: rgba(255,255,255,0.3);
                        transform: scale(1.1);
                    }
                    body:hover .close-btn {
                        opacity: 1;
                    }
                </style>
            </head>
            <body>
                <button class="close-btn" id="close-btn">×</button>
                <div class="lyrics-container" id="lyrics-container">
                    <div class="lyrics" id="lyrics-text">♪ 暂无歌词 ♪</div>
                </div>
                <script>
                    // 注意：contextIsolation 环境下没有 require，必须使用 preload 暴露的 API
                    const lyricsAPI = window.electronAPI ? window.electronAPI.desktopLyrics : null;

                    let isDragging = false;

                    // 关闭按钮事件
                    document.getElementById('close-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (lyricsAPI) lyricsAPI.close();
                    });

                    // 拖动功能
                    const lyricsContainer = document.getElementById('lyrics-container');

                    lyricsContainer.addEventListener('mousedown', (e) => {
                        isDragging = true;
                        if (!lyricsAPI) return;
                        lyricsAPI.dragStart({
                            startX: e.screenX,
                            startY: e.screenY
                        });
                    });

                    document.addEventListener('mousemove', (e) => {
                        if (isDragging && lyricsAPI) {
                            lyricsAPI.dragMove({
                                screenX: e.screenX,
                                screenY: e.screenY
                            });
                        }
                    });

                    document.addEventListener('mouseup', () => {
                        if (isDragging) {
                            isDragging = false;
                            if (lyricsAPI) lyricsAPI.dragEnd();
                        }
                    });

                    // 防止拖动时选中文字
                    document.addEventListener('selectstart', (e) => {
                        if (isDragging) {
                            e.preventDefault();
                        }
                    });
                </script>
            </body>
            </html>
        `);

        // 窗口关闭时
        this.lyricsWindow.on('closed', () => {
            this.lyricsWindow = null;
        });
    }

    // 显示歌词窗口
    async showLyricsWindow(lyrics = '♪ 暂无歌词 ♪') {
        try {
            if (!this.lyricsWindow) {
                this.createLyricsWindow();
            }
            
            // 显示窗口
            this.lyricsWindow.show();
            this.lyricsWindow.focus();
            
            // 更新歌词内容
            await this.lyricsWindow.webContents.executeJavaScript(`
                const lyricsElement = document.getElementById('lyrics-text');
                if (lyricsElement) {
                    lyricsElement.textContent = \`${lyrics.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`;
                }
            `);
            
            return { success: true };
        } catch (error) {
            console.error('显示歌词窗口失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 隐藏歌词窗口
    async hideLyricsWindow() {
        try {
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                this.lyricsWindow.hide();
            }
            return { success: true };
        } catch (error) {
            console.error('隐藏歌词窗口失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 设置IPC处理器
    setupIPC() {
        // 工具管理功能
        ipcMain.handle('tools-force-download', async (event, toolName) => {
            try {
                console.log(`强制重新下载工具: ${toolName}`);
                
                // 提供进度回调
                const onProgress = (progress, downloaded, total) => {
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('tool-download-progress', {
                            tool: toolName,
                            progress,
                            downloaded,
                            total
                        });
                    }
                };
                
                const result = await this.toolsManager.downloadTool(toolName, onProgress);
                console.log(`强制下载 ${toolName} 完成: ${result}`);
                
                return {
                    success: true,
                    path: result,
                    message: `${toolName} 工具下载完成`
                };
                
            } catch (error) {
                console.error(`强制下载 ${toolName} 失败:`, error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('tools-diagnose', async (event, toolName) => {
            try {
                const diagnosis = await this.toolsManager.diagnoseToolStatus(toolName);
                return {
                    success: true,
                    diagnosis
                };
            } catch (error) {
                console.error(`诊断 ${toolName} 失败:`, error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('tools-get-status', async (event) => {
            try {
                const tools = ['yt-dlp', 'ffmpeg'];
                const status = {};
                
                for (const tool of tools) {
                    status[tool] = {
                        available: await this.toolsManager.isToolAvailable(tool),
                        path: await this.toolsManager.getExecutableCommand(tool),
                        systemAvailable: await this.toolsManager.isSystemToolAvailable(tool)
                    };
                }
                
                return {
                    success: true,
                    status
                };
            } catch (error) {
                console.error('获取工具状态失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('tools-validate-binaries', async (event) => {
            try {
                const validation = await this.validateBinaries();
                return {
                    success: true,
                    validation
                };
            } catch (error) {
                console.error('验证二进制文件失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('tools-reset', async (event) => {
            try {
                console.log('重置工具设置...');
                
                // 重新设置工具
                const results = await this.toolsManager.setupTools((tool, progress, downloaded, total) => {
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('tool-download-progress', {
                            tool,
                            progress,
                            downloaded,
                            total
                        });
                    }
                });
                
                return {
                    success: true,
                    results
                };
                
            } catch (error) {
                console.error('重置工具失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('debug-get-paths', async (event) => {
            try {
                const paths = {
                    appBinDir: this.toolsManager.appBinDir,
                    userBinDir: this.toolsManager.userBinDir,
                    musicDir: this.musicDir,
                    tempDir: this.tempDir,
                    thumbnailsDir: this.thumbnailsDir,
                    lyricsDir: this.lyricsDir,
                    isPackaged: app.isPackaged,
                    resourcesPath: process.resourcesPath
                };
                
                return {
                    success: true,
                    paths
                };
            } catch (error) {
                console.error('获取路径信息失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 应用控制
        ipcMain.handle('app-quit', async () => {
            app.quit();
        });

        ipcMain.handle('app-relaunch', async () => {
            app.relaunch();
            app.exit();
        });

        ipcMain.handle('window-open-dev-tools', async () => {
            if (this.mainWindow) {
                this.mainWindow.webContents.openDevTools();
            }
        });
        
        ipcMain.handle('window-show-dev-tools', async () => {
            if (this.mainWindow) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        ipcMain.handle('cleanup-temp-files', async () => {
            try {
                const tempFiles = await fs.readdir(this.tempDir);
                for (const file of tempFiles) {
                    await fs.unlink(path.join(this.tempDir, file));
                }
                return { success: true, count: tempFiles.length };
            } catch (error) {
                console.error('清理临时文件失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 系统信息
        ipcMain.handle('system-info', async () => {
            try {
                const info = {
                    platform: process.platform,
                    arch: process.arch,
                    electronVersion: process.versions.electron,
                    nodeVersion: process.versions.node,
                    chromeVersion: process.versions.chrome,
                    userDataPath: app.getPath('userData'),
                    appPath: app.getAppPath(),
                    isPackaged: app.isPackaged
                };
                
                return {
                    success: true,
                    info
                };
            } catch (error) {
                console.error('获取系统信息失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 错误报告
        ipcMain.handle('error-report', async (event, errorInfo) => {
            try {
                console.error('渲染进程错误:', errorInfo);
                
                // 可以在这里添加错误报告逻辑
                // 例如：保存到日志文件、发送到服务器等
                
                return {
                    success: true,
                    message: '错误报告已记录'
                };
            } catch (error) {
                console.error('处理错误报告失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 其他功能
        ipcMain.handle('util-clean-filename', async (event, filename) => {
            return this.cleanFileName(filename);
        });

        ipcMain.handle('util-file-exists', async (event, filePath) => {
            return await this.fileExists(filePath);
        });

        ipcMain.handle('util-get-file-size', async (event, filePath) => {
            try {
                const stats = await fs.stat(filePath);
                return {
                    success: true,
                    size: stats.size
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 隐私模式（老板键）
        ipcMain.handle('privacy-toggle', async () => {
            this.togglePrivacy();
            return { success: true, active: this.privacyActive };
        });

        ipcMain.handle('privacy-get-settings', async () => {
            return { success: true, settings: { ...this.privacySettings } };
        });

        ipcMain.handle('privacy-set-settings', async (event, settings) => {
            try {
                if (!settings || typeof settings !== 'object') {
                    return { success: false, error: '无效的设置' };
                }

                this.privacySettings = { ...this.privacySettings, ...settings };
                await this.database.setSetting('privacy_settings', this.privacySettings);

                // 重新注册快捷键
                const ok = this.applyPrivacyShortcut();
                if (!ok) {
                    return {
                        success: false,
                        error: `快捷键 ${this.privacySettings.accelerator} 注册失败（可能被其他程序占用），请换一个键位`
                    };
                }

                return { success: true, settings: { ...this.privacySettings } };
            } catch (error) {
                console.error('保存隐私设置失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 主题设置
        ipcMain.handle('theme-set', async (event, theme) => {
            try {
                await this.database.setSetting('theme', theme);
                return {
                    success: true,
                    theme
                };
            } catch (error) {
                console.error('设置主题失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('theme-get', async () => {
            try {
                const theme = await this.database.getSetting('theme', 'dark');
                return {
                    success: true,
                    theme
                };
            } catch (error) {
                console.error('获取主题失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 应用信息
        ipcMain.handle('app-get-version', async () => {
            try {
                const packageInfo = require('./package.json');
                return {
                    success: true,
                    version: packageInfo.version,
                    name: packageInfo.name,
                    description: packageInfo.description,
                    author: packageInfo.author
                };
            } catch (error) {
                console.error('获取应用信息失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 检查更新（GitHub Releases；网络不通时静默失败）
        ipcMain.handle('app-check-update', async () => {
            return await this.checkForUpdates();
        });

        // 帮助和关于
        ipcMain.handle('help-get-shortcuts', async () => {
            try {
                const shortcuts = [
                    { key: 'Space', description: '播放/暂停' },
                    { key: 'Ctrl+O', description: '打开文件' },
                    { key: 'Ctrl+L', description: '显示歌词' },
                    { key: 'Ctrl+F', description: '搜索' },
                    { key: 'Ctrl+P', description: '播放列表' },
                    { key: 'Ctrl+S', description: '设置' },
                    { key: 'Ctrl+Q', description: '退出' },
                    { key: 'Ctrl+R', description: '刷新' },
                    { key: 'F11', description: '全屏' },
                    { key: 'F12', description: '开发者工具' }
                ];
                
                return {
                    success: true,
                    shortcuts
                };
            } catch (error) {
                console.error('获取快捷键帮助失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('help-get-about', async () => {
            try {
                const packageInfo = require('./package.json');
                const about = {
                    name: packageInfo.name,
                    version: packageInfo.version,
                    description: packageInfo.description,
                    author: packageInfo.author,
                    license: packageInfo.license,
                    electronVersion: process.versions.electron,
                    nodeVersion: process.versions.node,
                    chromeVersion: process.versions.chrome,
                    platform: process.platform,
                    arch: process.arch
                };
                
                return {
                    success: true,
                    about
                };
            } catch (error) {
                console.error('获取关于信息失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 文件操作
        ipcMain.handle('file-select-music', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                title: '选择音乐文件',
                properties: ['openFile', 'multiSelections'],
                filters: [
                    { name: '音频文件', extensions: ['mp3', 'm4a', 'wav', 'flac', 'aac'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const songs = [];
                for (const filePath of result.filePaths) {
                    try {
                        const songData = await this.extractAudioMetadata(filePath);
                        const songId = await this.database.addSong(songData);
                        songs.push({ ...songData, id: songId });

                        // 自动分析音量（后台进行，不阻塞）
                        const targetLufs = await this.database.getSetting('volume_target_lufs', -16);
                        this.analyzeSongVolume(songId, targetLufs).catch(error => {
                            console.log('音量分析失败（不影响导入）:', error.message);
                        });
                    } catch (error) {
                        console.error('处理音乐文件失败:', filePath, error);
                    }
                }
                return songs;
            }
            return [];
        });

        ipcMain.handle('file-show-in-explorer', async (event, filePath) => {
            shell.showItemInFolder(filePath);
        });

        // 选择 cookies.txt 文件（YouTube 下载用）
        ipcMain.handle('file-select-cookies', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                title: '选择 cookies.txt 文件',
                properties: ['openFile'],
                filters: [
                    { name: 'Cookies 文件', extensions: ['txt'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            return null;
        });

        ipcMain.handle('file-open-external', async (event, url) => {
            shell.openExternal(url);
        });

        // 下载功能
        ipcMain.handle('download-bilibili-video', async (event, url, options = {}) => {
            return await this.downloadBilibiliVideo(url, options);
        });

        // 通用音源下载（B站 / YouTube，同一管线）
        ipcMain.handle('download-media', async (event, url, options = {}) => {
            return await this.downloadBilibiliVideo(url, options);
        });

        ipcMain.handle('download-get-video-info', async (event, url) => {
            return await this.getVideoInfo(url);
        });

        // ==================== OCR / 语音识别（音频转歌词） ====================

        // 选择图片（OCR 用）
        ipcMain.handle('ocr-select-image', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                title: '选择歌词/课文图片',
                properties: ['openFile'],
                filters: [
                    { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });
            if (!result.canceled && result.filePaths.length > 0) {
                return result.filePaths[0];
            }
            return null;
        });

        // 图片 OCR（Windows 内置引擎，零下载）
        ipcMain.handle('ocr-image', async (event, imagePath) => {
            try {
                return await this.ocrManager.recognizeImage(imagePath);
            } catch (error) {
                console.error('OCR 失败:', error);
                return { success: false, error: error.message };
            }
        });

        // whisper 状态（工具 + 模型列表 + 当前选择）
        ipcMain.handle('whisper-get-status', async () => {
            try {
                return {
                    success: true,
                    toolAvailable: !!(await this.toolsManager.getExecutableCommand('whisper')),
                    models: await this.toolsManager.listWhisperModels(),
                    currentModel: await this.database.getSetting('whisper_model', 'base')
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        // 下载模型（用户选择规格后才下载，带进度事件）
        ipcMain.handle('whisper-download-model', async (event, modelKey) => {
            try {
                await this.toolsManager.downloadWhisperModel(modelKey, (progress, downloaded, total) => {
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('whisper-model-progress', {
                            modelKey, progress, downloaded, total
                        });
                    }
                });
                return { success: true };
            } catch (error) {
                console.error(`模型 ${modelKey} 下载失败:`, error);
                return { success: false, error: error.message };
            }
        });

        // 设置当前使用的模型
        ipcMain.handle('whisper-set-model', async (event, modelKey) => {
            if (!this.toolsManager.whisperModels[modelKey]) {
                return { success: false, error: '未知的模型规格' };
            }
            await this.database.setSetting('whisper_model', modelKey);
            return { success: true };
        });

        // 删除模型（释放磁盘空间）
        ipcMain.handle('whisper-delete-model', async (event, modelKey) => {
            return { success: await this.toolsManager.deleteWhisperModel(modelKey) };
        });

        // 音频转歌词（whisper 多语言自动检测 → LRC）
        ipcMain.handle('transcribe-song', async (event, songId) => {
            try {
                return await this.transcribeSong(songId);
            } catch (error) {
                if (this.downloadCancelRequested) {
                    return { success: false, cancelled: true };
                }
                console.error('音频转写失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 取消下载：终止所有下载相关子进程并清理临时文件
        ipcMain.handle('download-cancel', async () => {            try {
                this.downloadCancelRequested = true;

                for (const child of this.downloadProcesses) {
                    try { child.kill(); } catch (e) { /* 进程可能已退出 */ }
                }
                this.downloadProcesses.clear();

                // 清理临时文件（仅清理带 _temp 标记的下载残留）
                try {
                    const files = await fs.readdir(this.tempDir);
                    for (const file of files) {
                        if (file.includes('_temp')) {
                            await fs.unlink(path.join(this.tempDir, file)).catch(() => {});
                        }
                    }
                } catch (e) { /* 目录不存在等情况忽略 */ }

                console.log('下载已取消');
                return { success: true };
            } catch (error) {
                console.error('取消下载失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 歌词功能
        ipcMain.handle('lyrics-download', async (event, url, title) => {
            return await this.lyricsManager.downloadLyrics(url, title);
        });

        ipcMain.handle('lyrics-search', async (event, query) => {
            return await this.lyricsManager.searchLyrics(query);
        });

        ipcMain.handle('lyrics-get', async (event, title) => {
            const result = await this.lyricsManager.getLyrics(title);
            // 渲染进程需要的是 [{time, text}] 数组，这里解析 LRC 原文
            if (result.success && result.lyrics) {
                result.lyrics = this.lyricsManager.parseLrcContent(result.lyrics) || [];
            }
            return result;
        });

        ipcMain.handle('lyrics-delete', async (event, title) => {
            return await this.lyricsManager.deleteLyrics(title);
        });

        ipcMain.handle('lyrics-show-window', async (event, lyrics) => {
            return await this.showLyricsWindow(lyrics);
        });

        ipcMain.handle('lyrics-hide-window', async () => {
            return await this.hideLyricsWindow();
        });

        // 数据库操作
        ipcMain.handle('database-get-songs', async () => {
            return await this.database.getAllSongs();
        });
        
        ipcMain.handle('database-get-all-songs', async () => {
            return await this.database.getAllSongs();
        });

        ipcMain.handle('database-add-song', async (event, songData) => {
            return await this.database.addSong(songData);
        });

        ipcMain.handle('database-update-song', async (event, songId, songData) => {
            return await this.database.updateSong(songId, songData);
        });

        ipcMain.handle('database-delete-song', async (event, songId) => {
            // 完整删除：音频文件 + 缩略图 + 歌词文件 + 数据库记录
            // 播放停止由渲染进程在调用前自行处理（音频元素在渲染进程）
            return await this.deleteSongWithFile(songId);
        });

        ipcMain.handle('database-remove-song', async (event, songId) => {
            return await this.deleteSongWithFile(songId);
        });

        // 播放列表功能
        ipcMain.handle('database-create-playlist', async (event, name, description) => {
            // 兼容旧接口（只有name参数）
            if (typeof description === 'undefined') {
                description = '';
            }
            return await this.database.createPlaylist(name, description);
        });

        ipcMain.handle('database-get-all-playlists', async () => {
            return await this.database.getAllPlaylists();
        });

        ipcMain.handle('database-get-playlist', async (event, playlistId) => {
            return await this.database.getPlaylist(playlistId);
        });

        ipcMain.handle('database-update-playlist', async (event, playlistId, name, description) => {
            return await this.database.updatePlaylist(playlistId, name, description);
        });

        ipcMain.handle('database-remove-playlist', async (event, playlistId) => {
            return await this.database.removePlaylist(playlistId);
        });

        ipcMain.handle('database-delete-playlist', async (event, playlistId) => {
            return await this.database.removePlaylist(playlistId);
        });

        ipcMain.handle('database-get-playlist-songs', async (event, playlistId) => {
            return await this.database.getPlaylistSongs(playlistId);
        });

        ipcMain.handle('database-add-to-playlist', async (event, playlistId, songId) => {
            return await this.database.addToPlaylist(playlistId, songId);
        });
        
        ipcMain.handle('database-add-song-to-playlist', async (event, playlistId, songId) => {
            return await this.database.addToPlaylist(playlistId, songId);
        });

        ipcMain.handle('database-remove-from-playlist', async (event, playlistId, songId) => {
            return await this.database.removeFromPlaylist(playlistId, songId);
        });
        
        ipcMain.handle('database-remove-song-from-playlist', async (event, playlistId, songId) => {
            return await this.database.removeFromPlaylist(playlistId, songId);
        });

        // 收藏功能
        ipcMain.handle('database-toggle-favorite', async (event, songId) => {
            return await this.database.toggleFavorite(songId);
        });

        ipcMain.handle('database-get-favorites', async () => {
            return await this.database.getFavorites();
        });

        // 搜索功能
        ipcMain.handle('database-search-songs', async (event, query) => {
            return await this.database.searchSongs(query);
        });

        ipcMain.handle('database-get-songs-by-artist', async (event, artist) => {
            return await this.database.getSongsByArtist(artist);
        });

        ipcMain.handle('database-get-songs-by-album', async (event, album) => {
            return await this.database.getSongsByAlbum(album);
        });

        // 统计功能
        ipcMain.handle('database-get-stats', async () => {
            return await this.database.getStats();
        });

        // 新增歌单功能
        ipcMain.handle('database-is-song-in-playlist', async (event, playlistId, songId) => {
            return await this.database.isSongInPlaylist(playlistId, songId);
        });

        ipcMain.handle('database-get-song-playlists', async (event, songId) => {
            return await this.database.getSongPlaylists(songId);
        });

        ipcMain.handle('database-add-songs-to-playlist', async (event, playlistId, songIds) => {
            return await this.database.addSongsToPlaylist(playlistId, songIds);
        });

        // 播放历史功能
        ipcMain.handle('database-add-play-history', async (event, songId) => {
            return await this.database.addPlayHistory(songId);
        });

        ipcMain.handle('database-get-play-history', async (event, limit = 100) => {
            return await this.database.getPlayHistory(limit);
        });

        ipcMain.handle('database-get-recently-played', async (event, limit = 50) => {
            return await this.database.getRecentlyPlayed(limit);
        });

        ipcMain.handle('database-cleanup-play-history', async (event, keepCount = 1000) => {
            return await this.database.cleanupPlayHistory(keepCount);
        });

        // 设置管理功能
        ipcMain.handle('database-set-setting', async (event, key, value) => {
            return await this.database.setSetting(key, value);
        });

        ipcMain.handle('database-get-setting', async (event, key, defaultValue = null) => {
            return await this.database.getSetting(key, defaultValue);
        });

        ipcMain.handle('database-get-all-settings', async () => {
            return await this.database.getAllSettings();
        });

        ipcMain.handle('database-delete-setting', async (event, key) => {
            return await this.database.deleteSetting(key);
        });

        // 音量分析功能
        ipcMain.handle('volume-analyze-song', async (event, songId, targetLufs = -16) => {
            return await this.analyzeSongVolume(songId, targetLufs);
        });

        ipcMain.handle('volume-get-unanalyzed-songs', async () => {
            return await this.database.getUnanalyzedSongs();
        });

        ipcMain.handle('volume-get-stats', async () => {
            const total = await this.database.getTotalSongsCount();
            const analyzed = await this.database.getAnalyzedSongsCount();
            return {
                total: total,
                analyzed: analyzed,
                unanalyzed: total - analyzed
            };
        });

        // 批量更新所有已分析歌曲的音量增益（当目标响度改变时调用）
        ipcMain.handle('volume-batch-update-gains', async (event, newTargetLufs) => {
            return await this.database.batchUpdateVolumeGains(newTargetLufs);
        });

        // 文件状态检查
        ipcMain.handle('file-check-songs-status', async () => {
            try {
                const result = await this.checkSongsFileStatus();
                return result;
            } catch (error) {
                console.error('检查歌曲文件状态失败:', error);
                return { success: false, error: error.message };
            }
        });
        
        ipcMain.handle('check-songs-file-status', async () => {
            try {
                const result = await this.checkSongsFileStatus();
                return { success: true, result };
                    } catch (error) {
                console.error('检查歌曲文件状态失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 音频元数据提取
        ipcMain.handle('extract-audio-metadata', async (event, filePath) => {
            try {
                const metadata = await this.extractAudioMetadata(filePath);
                return { success: true, metadata };
            } catch (error) {
                console.error('提取音频元数据失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 音频转换
        ipcMain.handle('convert-to-mp3', async (event, inputPath, outputName) => {
            try {
                const outputPath = await this.convertToMP3(inputPath, outputName);
                return { success: true, outputPath };
            } catch (error) {
                console.error('转换音频失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 缩略图处理
        ipcMain.handle('download-thumbnail', async (event, url, title) => {
            try {
                const thumbnailPath = await this.downloadThumbnail(url, title);
                return { success: true, thumbnailPath };
            } catch (error) {
                console.error('下载缩略图失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 获取视频信息
        ipcMain.handle('get-video-info', async (event, url) => {
            try {
                const videoInfo = await this.getVideoInfo(url);
                return { success: true, videoInfo };
            } catch (error) {
                console.error('获取视频信息失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 歌词窗口管理
        ipcMain.handle('show-lyrics-window', async (event, lyrics) => {
            try {
                await this.showLyricsWindow(lyrics);
                return { success: true };
            } catch (error) {
                console.error('显示歌词窗口失败:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('hide-lyrics-window', async () => {
            try {
                await this.hideLyricsWindow();
                return { success: true };
            } catch (error) {
                console.error('隐藏歌词窗口失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 清理方法
        ipcMain.handle('cleanup', async () => {
            try {
                await this.cleanup();
                return { success: true };
            } catch (error) {
                console.error('清理失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 全屏功能
        ipcMain.handle('window-toggle-fullscreen', async () => {
            try {
                if (this.mainWindow) {
                    const isFullscreen = this.mainWindow.isFullScreen();
                    this.mainWindow.setFullScreen(!isFullscreen);
                    return { success: true, isFullscreen: !isFullscreen };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('切换全屏失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 窗口控制
        ipcMain.handle('window-minimize', async () => {
            try {
                if (this.mainWindow) {
                    this.mainWindow.minimize();
                    return { success: true };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('最小化窗口失败:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('window-maximize', async () => {
            try {
                if (this.mainWindow) {
                    if (this.mainWindow.isMaximized()) {
                        this.mainWindow.unmaximize();
                    } else {
                        this.mainWindow.maximize();
                    }
                    return { success: true, isMaximized: this.mainWindow.isMaximized() };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('最大化窗口失败:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('window-close', async () => {
            try {
                if (this.mainWindow) {
                    this.mainWindow.close();
                    return { success: true };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('关闭窗口失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 开发者工具
        ipcMain.handle('dev-clear-cache', async () => {
            try {
                if (this.mainWindow) {
                    await this.mainWindow.webContents.session.clearCache();
                    return { success: true };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('清理缓存失败:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('dev-clear-storage', async () => {
            try {
                if (this.mainWindow) {
                    await this.mainWindow.webContents.session.clearStorageData();
                    return { success: true };
                }
                return { success: false, error: '主窗口未找到' };
            } catch (error) {
                console.error('清理存储失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 性能监控
        ipcMain.handle('performance-get-memory', async () => {
            try {
                const memoryUsage = process.memoryUsage();
                return {
                    success: true,
                    memory: {
                        rss: memoryUsage.rss,
                        heapTotal: memoryUsage.heapTotal,
                        heapUsed: memoryUsage.heapUsed,
                        external: memoryUsage.external
                    }
                };
            } catch (error) {
                console.error('获取内存使用失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('performance-get-cpu', async () => {
            try {
                const cpuUsage = process.cpuUsage();
                return {
                    success: true,
                    cpu: {
                        user: cpuUsage.user,
                        system: cpuUsage.system
                    }
                };
            } catch (error) {
                console.error('获取CPU使用失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 资源管理
        ipcMain.handle('resource-get-disk-usage', async () => {
            try {
                const dirs = [this.musicDir, this.tempDir, this.thumbnailsDir, this.lyricsDir];
                const usage = {};
                
                for (const dir of dirs) {
                    let totalSize = 0;
                    let fileCount = 0;
                    
                    try {
                        const files = await fs.readdir(dir);
                        for (const file of files) {
                            const filePath = path.join(dir, file);
                            const stats = await fs.stat(filePath);
                            if (stats.isFile()) {
                                totalSize += stats.size;
                                fileCount++;
                            }
                        }
                    } catch (error) {
                        console.warn(`无法读取目录 ${dir}:`, error);
                    }
                    
                    usage[path.basename(dir)] = {
                        totalSize,
                        fileCount,
                        path: dir
                    };
                }
                
                return {
                    success: true,
                    usage
                };
            } catch (error) {
                console.error('获取磁盘使用失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 统计信息
        ipcMain.handle('stats-get-usage', async () => {
            try {
                const stats = await this.database.getStats();
                return {
                    success: true,
                    stats
                };
            } catch (error) {
                console.error('获取使用统计失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 备份和恢复
        ipcMain.handle('backup-database', async () => {
            try {
                const backupPath = path.join(app.getPath('userData'), 'backups');
                await fs.mkdir(backupPath, { recursive: true });
                
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupFile = path.join(backupPath, `music_backup_${timestamp}.db`);
                
                await fs.copyFile(path.join(app.getPath('userData'), 'music.db'), backupFile);
                
                return {
                    success: true,
                    backupPath: backupFile
                };
            } catch (error) {
                console.error('备份数据库失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('restore-database', async (event, backupPath) => {
            try {
                const dbPath = path.join(app.getPath('userData'), 'music.db');
                
                // 关闭当前数据库连接
                await this.database.close();
                
                // 恢复数据库文件
                await fs.copyFile(backupPath, dbPath);
                
                // 重新初始化数据库
                await this.database.initialize();
                
                return {
                    success: true,
                    message: '数据库恢复成功'
                };
            } catch (error) {
                console.error('恢复数据库失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 实验性功能
        ipcMain.handle('experimental-feature-toggle', async (event, featureName, enabled) => {
            try {
                const configStr = await this.database.getSetting('experimental_features', '{}');
                const config = JSON.parse(configStr);
                config[featureName] = enabled;
                
                await this.database.setSetting('experimental_features', JSON.stringify(config));
                
                return {
                    success: true,
                    feature: featureName,
                    enabled
                };
            } catch (error) {
                console.error('切换实验性功能失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('experimental-get-features', async () => {
            try {
                const configStr = await this.database.getSetting('experimental_features', '{}');
                const features = JSON.parse(configStr);
                
                return {
                    success: true,
                    features
                };
            } catch (error) {
                console.error('获取实验性功能失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 语言设置
        ipcMain.handle('i18n-set-language', async (event, language) => {
            try {
                await this.database.setSetting('language', language);
                return {
                    success: true,
                    language
                };
            } catch (error) {
                console.error('设置语言失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        ipcMain.handle('i18n-get-language', async () => {
            try {
                const language = await this.database.getSetting('language', 'zh-CN');
                return {
                    success: true,
                    language
                };
            } catch (error) {
                console.error('获取语言失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 兼容性处理器 - 清理缺失的歌曲
        ipcMain.handle('file-clean-missing-songs', async () => {
            try {
                const missingFiles = await this.checkSongsFileStatus();
                let cleaned = 0;
                
                for (const missing of missingFiles) {
                    await this.database.removeSong(missing.id);
                    cleaned++;
                }
                
                return {
                    success: true,
                    cleaned,
                    message: `已清理 ${cleaned} 个缺失的歌曲记录`
                };
            } catch (error) {
                console.error('清理缺失歌曲失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 兼容性处理器 - 检查文件状态
        ipcMain.handle('file-check-status', async (event, filePath) => {
            try {
                const exists = await this.fileExists(filePath);
                return {
                    success: true,
                    exists,
                    path: filePath
                };
            } catch (error) {
                console.error('检查文件状态失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 兼容性处理器 - 歌词保存
        ipcMain.handle('lyrics-save', async (event, songTitle, lrcContent) => {
            try {
                const result = await this.lyricsManager.saveLyrics(songTitle, lrcContent);
                return {
                    success: true,
                    result
                };
            } catch (error) {
                console.error('保存歌词失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 兼容性处理器 - 歌词窗口切换
        ipcMain.handle('lyrics-window-toggle', async () => {
            try {
                if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                    this.lyricsWindow.close();
                    this.lyricsWindow = null;
                    return { success: true, visible: false };
                } else {
                    await this.showLyricsWindow('♪ 暂无歌词 ♪');
                    return { success: true, visible: true };
                }
            } catch (error) {
                console.error('切换歌词窗口失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 兼容性处理器 - 歌词窗口更新
        ipcMain.handle('lyrics-window-update', async (event, text) => {
            try {
                if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                    await this.lyricsWindow.webContents.executeJavaScript(`
                        const lyricsElement = document.getElementById('lyrics-text');
                        if (lyricsElement) {
                            lyricsElement.textContent = \`${text.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`;
                        }
                    `);
                    return { success: true };
                } else {
                    return { success: false, error: '歌词窗口未打开' };
                }
            } catch (error) {
                console.error('更新歌词窗口失败:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // 桌面歌词窗口事件处理
        let dragData = null;
        
        // 歌词窗口关闭
        ipcMain.on('lyrics-window-close', () => {
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                this.lyricsWindow.close();
                this.lyricsWindow = null;
            }
        });
        
        // 歌词窗口拖动开始
        ipcMain.on('lyrics-window-drag-start', (event, data) => {
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                const [windowX, windowY] = this.lyricsWindow.getPosition();
                dragData = {
                    startX: data.startX,
                    startY: data.startY,
                    startWindowX: windowX,
                    startWindowY: windowY
                };
            }
        });
        
        // 歌词窗口拖动移动
        ipcMain.on('lyrics-window-drag-move', (event, data) => {
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed() && dragData) {
                const newX = dragData.startWindowX + data.screenX - dragData.startX;
                const newY = dragData.startWindowY + data.screenY - dragData.startY;
                this.lyricsWindow.setPosition(newX, newY);
            }
        });
        
        // 歌词窗口拖动结束
        ipcMain.on('lyrics-window-drag-end', () => {
            dragData = null;
        });

    }

    // 获取网络参数（UA / Referer / 代理 / cookies）
    // B站对无浏览器特征的请求有风控（HTTP 412），统一伪装浏览器 UA 并按站点补 Referer
    async getNetworkArgs(url = '') {
        const args = [
            '--user-agent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        ];

        if (/bilibili\.com|b23\.tv/i.test(url)) {
            args.push('--add-headers', 'Referer:https://www.bilibili.com/');
        } else if (/youtube\.com|youtu\.be/i.test(url)) {
            args.push('--add-headers', 'Referer:https://www.youtube.com/');
        }

        try {
            const proxy = await this.database.getSetting('download_proxy', '');
            if (proxy && typeof proxy === 'string' && proxy.trim()) {
                args.push('--proxy', proxy.trim());
            }
            const cookiesPath = await this.database.getSetting('cookies_path', '');
            if (cookiesPath && typeof cookiesPath === 'string' && cookiesPath.trim()) {
                args.push('--cookies', cookiesPath.trim());
            }
        } catch (error) {
            console.warn('读取网络设置失败:', error.message);
        }
        return args;
    }

    // ==================== 检查更新（GitHub Releases） ====================

    // 比较语义化版本号：a>b 返回 1，a<b 返回 -1，相等返回 0
    compareVersions(a, b) {
        const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            const x = pa[i] || 0;
            const y = pb[i] || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    }

    // 查询 GitHub 最新 Release（10 秒超时，失败静默）
    async checkForUpdates() {
        const https = require('https');
        const current = require('./package.json').version;

        const fetchJson = (url, redirectsLeft = 3) => new Promise((resolve, reject) => {
            const req = https.get(url, {
                headers: {
                    'User-Agent': 'SakuraEcho-Updater',
                    'Accept': 'application/vnd.github+json'
                },
                timeout: 10000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                    res.resume();
                    fetchJson(res.headers.location, redirectsLeft - 1).then(resolve, reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                });
            });
            req.on('timeout', () => { req.destroy(new Error('网络超时')); });
            req.on('error', reject);
        });

        try {
            const release = await fetchJson('https://api.github.com/repos/xuzhili835/MusicPlayer/releases/latest');
            const remote = String(release.tag_name || '').replace(/^v/i, '');
            const hasUpdate = this.compareVersions(remote, current) > 0;
            return {
                success: true,
                hasUpdate,
                current,
                remote,
                url: release.html_url || 'https://github.com/xuzhili835/MusicPlayer/releases',
                notes: (release.body || '').slice(0, 600)
            };
        } catch (error) {
            console.log('检查更新失败（静默）:', error.message);
            return { success: false, error: error.message, current, hasUpdate: false };
        }
    }

    // 启动后静默检查一次更新（联网时），发现新版本通知渲染进程
    scheduleUpdateCheck() {
        setTimeout(async () => {
            try {
                const result = await this.checkForUpdates();
                if (result.success && result.hasUpdate && this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('update-available', {
                        current: result.current,
                        remote: result.remote,
                        url: result.url
                    });
                }
            } catch (error) { /* 静默 */ }
        }, 8000);
    }

    // 获取视频信息
    async getVideoInfo(url) {
        try {
            // 使用工具管理器获取正确的可执行路径
            const ytdlpPath = await this.toolsManager.getExecutableCommand('yt-dlp');

            if (!ytdlpPath) {
                const diagnosis = await this.toolsManager.diagnoseToolStatus('yt-dlp');
                let errorMsg = 'yt-dlp工具不可用。';

                if (diagnosis.issues.length > 0) {
                    errorMsg += '问题：' + diagnosis.issues.join(', ') + '。';
                }

                if (diagnosis.recommendations.length > 0) {
                    errorMsg += '建议：' + diagnosis.recommendations.join(', ') + '。';
                }

                throw new Error(errorMsg);
            }

            console.log(`使用yt-dlp路径: ${ytdlpPath}`);

            // 异步执行，不阻塞主进程；数组参数避免 shell 引号问题；注入 UA/Referer/代理/cookies
            const networkArgs = await this.getNetworkArgs(url);
            const stdout = await this.executeCommand(
                ['yt-dlp', '--dump-json', '--no-playlist', ...networkArgs, url],
                { timeout: 30000, maxBuffer: 1024 * 1024 * 10, silent: true }
            );

            const videoInfo = JSON.parse(stdout);

            return {
                title: videoInfo.title,
                uploader: videoInfo.uploader,
                duration: videoInfo.duration,
                thumbnail: videoInfo.thumbnail,
                description: videoInfo.description
            };
        } catch (error) {
            console.error('获取视频信息失败:', error);

            if (this.downloadCancelRequested || error.message === '下载已取消') {
                throw new Error('下载已取消');
            }

            // 提供更详细的错误信息
            let errorMessage = '获取视频信息失败：';

            if (error.message.includes('412') || error.message.includes('Precondition Failed')) {
                errorMessage += '被站点风控拦截（HTTP 412），请稍后重试。';
            } else if (error.message.includes('403')) {
                errorMessage += '站点拒绝访问（HTTP 403），可能需要登录或配置 cookies。';
            } else if (error.message.includes('权限')) {
                errorMessage += '权限不足，请检查防病毒软件设置。';
            } else if (error.message.includes('不是内部或外部命令')) {
                errorMessage += 'yt-dlp工具未找到或无法执行。';
            } else if (error.message.includes('timeout') || error.message.includes('超时')) {
                errorMessage += '请求超时，请检查网络连接。';
            } else if (error.message.includes('Private video')) {
                errorMessage += '视频是私有的，无法访问。';
            } else if (error.message.includes('Video unavailable')) {
                errorMessage += '视频不可用或已删除。';
            } else {
                errorMessage += error.message;
            }

            throw new Error(errorMessage);
        }
    }

    // 下载B站视频
    async downloadBilibiliVideo(url, options = {}) {
        // 单任务锁：同一时间只允许一个下载任务
        if (this.downloadInProgress) {
            throw new Error('已有下载任务正在进行中，请等待完成或先取消');
        }
        this.downloadInProgress = true;

        try {
            return await this._doDownload(url, options);
        } finally {
            this.downloadInProgress = false;
        }
    }

    async _doDownload(url, options = {}) {
        try {
            console.log('开始下载视频:', url);

            // 复位取消标志（新一轮下载开始）
            this.downloadCancelRequested = false;

            // 定义总阶段数
            const totalStages = 5;
            let currentStage = 0;

            const sendStage = (description, isComplete = false) => {
                currentStage++;
                this.mainWindow.webContents.send('download-stage-progress', {
                    stage: currentStage,
                    totalStages: totalStages,
                    description,
                    isComplete
                });
            };

            // 阶段 1: 下载视频
            sendStage('正在下载视频文件...');

            // 获取视频信息
            const videoInfo = await this.getVideoInfo(url);
            const cleanTitle = this.cleanFileName(videoInfo.title);

            // 检测是否已下载过（通过source_url）
            const existingSong = await this.database.getSongByUrl(url);
            if (existingSong) {
                throw new Error('歌曲已存在于音乐库');
            }

            // 临时文件路径
            const tempAudioPath = path.join(this.tempDir, `${cleanTitle}_temp.%(ext)s`);

            // 下载最好质量的音频（注入 UA/Referer 规避站点风控，代理/cookies 用于 YouTube）
            const networkArgs = await this.getNetworkArgs(url);
            const downloadCommand = [
                'yt-dlp',
                '--extract-audio',
                '--audio-format', 'best',
                '--audio-quality', '0',
                '--output', tempAudioPath,
                '--no-playlist',
                ...networkArgs,
                url
            ];

            // 执行下载
            await this.executeCommand(downloadCommand);

            // 查找下载的文件
            const files = await fs.readdir(this.tempDir);
            const downloadedFile = files.find(file =>
                file.includes(cleanTitle) && file.includes('_temp') &&
                (file.endsWith('.mp3') || file.endsWith('.m4a') || file.endsWith('.webm'))
            );

            if (!downloadedFile) {
                throw new Error('下载的文件未找到');
            }

            const tempFilePath = path.join(this.tempDir, downloadedFile);

            // 阶段 2: 转换为MP3
            sendStage('正在转换为 MP3 格式...');
            const finalPath = await this.convertToMP3(tempFilePath, cleanTitle);

            // 阶段 3: 同步音量
            sendStage('正在同步音量...');

            // 清理临时文件
            try {
                await fs.unlink(tempFilePath);
            } catch (error) {
                console.log('清理临时文件失败:', error);
            }

            // 下载并保存缩略图
            let localThumbnailPath = null;
            if (videoInfo.thumbnail) {
                try {
                    localThumbnailPath = await this.downloadThumbnail(videoInfo.thumbnail, cleanTitle);
                } catch (error) {
                    console.warn('下载缩略图失败:', error);
                }
            }

            // 添加到数据库
            const songData = {
                title: videoInfo.title,
                artist: videoInfo.uploader,
                duration: videoInfo.duration || 0,
                path: finalPath,
                source_url: url,
                thumbnail: localThumbnailPath || videoInfo.thumbnail
            };

            const songId = await this.database.addSong(songData);

            // 自动同步音量
            try {
                const targetLufs = await this.database.getSetting('volume_target_lufs', -16);
                await this.analyzeSongVolume(songId, targetLufs);
            } catch (error) {
                console.log('音量同步失败（不影响下载）:', error.message);
            }

            // 阶段 4: 下载歌词
            sendStage('正在下载歌词...');
            // 按用户选择下载字幕（默认开）
            if (options.downloadLyrics !== false) {
                try {
                    const proxy = await this.database.getSetting('download_proxy', '');
                    this.lyricsManager.proxy = (proxy && typeof proxy === 'string') ? proxy.trim() : '';
                    const result = await this.lyricsManager.downloadLyrics(url, videoInfo.title);
                    if (!result) {
                        // 未找到歌词，显示提示并短暂延迟
                        this.mainWindow.webContents.send('download-stage-progress', {
                            stage: 4,
                            totalStages: totalStages,
                            description: '未找到歌词',
                            isComplete: false
                        });
                        // 延迟500ms让用户看到
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    console.log('下载歌词失败:', error);
                    // 下载出错，显示提示并短暂延迟
                    this.mainWindow.webContents.send('download-stage-progress', {
                        stage: 4,
                        totalStages: totalStages,
                        description: '未找到歌词',
                        isComplete: false
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            // 阶段 5: 完成
            sendStage('下载完成！', true);

            // 下载后自动 AI 转写（用户勾选且模型就绪时）
            if (options.autoTranscribe) {
                try {
                    const modelKey = await this.database.getSetting('whisper_model', 'base');
                    if (await this.toolsManager.isWhisperModelDownloaded(modelKey)) {
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('transcribe-status', '下载完成，正在 AI 识别歌词...');
                        }
                        this.downloadCancelRequested = false;
                        const transcribed = await this.transcribeSong(songId);
                        if (transcribed && transcribed.success && transcribed.lrc) {
                            await this.lyricsManager.saveLyrics(videoInfo.title, transcribed.lrc);
                            if (this.mainWindow) {
                                this.mainWindow.webContents.send('transcribe-status', 'AI 歌词识别完成');
                            }
                            console.log('自动 AI 转写完成:', videoInfo.title);
                        }
                    } else {
                        console.log('自动转写跳过：模型未下载');
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('transcribe-status', '模型未下载，已跳过 AI 转写');
                        }
                    }
                } catch (transcribeError) {
                    console.log('自动 AI 转写失败（不影响下载结果）:', transcribeError.message);
                }
            }

            return {
                success: true,
                song: { ...songData, id: songId }
            };

        } catch (error) {
            console.error('下载视频失败:', error);

            // 用户主动取消，直接透传
            if (this.downloadCancelRequested || error.message === '下载已取消') {
                throw new Error('下载已取消');
            }

            // 提供用户友好的错误信息
            let errorMessage = '下载失败：';

            if (error.message.includes('412') || error.message.includes('Precondition Failed')) {
                errorMessage += '被站点风控拦截（HTTP 412）。请稍后重试；若反复出现，可在设置中配置代理。';
            } else if (error.message.includes('403')) {
                errorMessage += '站点拒绝访问（HTTP 403），可能需要登录。可在设置 → 网络与下载 中配置 cookies.txt。';
            } else if (error.message.includes('ffmpeg')) {
                errorMessage += 'ffmpeg工具不可用。请打开"检查控制台"并点击"强制重新下载工具"按钮，然后重试。';
            } else if (error.message.includes('yt-dlp')) {
                errorMessage += 'yt-dlp工具不可用。请打开"检查控制台"并点击"强制重新下载工具"按钮，然后重试。';
            } else if (error.message.includes('权限')) {
                errorMessage += '权限不足。请检查防病毒软件设置，或在"检查控制台"中查看详细信息。';
            } else {
                errorMessage += error.message;
            }

            throw new Error(errorMessage);
        }
    }

    // 转换为MP3格式
    async convertToMP3(inputPath, title) {
        try {
            const outputPath = path.join(this.musicDir, `${title}.mp3`);
            
            const convertCommand = [
                'ffmpeg',
                '-i', inputPath,
                '-codec:a', 'libmp3lame',
                '-b:a', '320k',
                '-y', // 覆盖现有文件
                outputPath
            ];
            
            await this.executeCommand(convertCommand);
            
            return outputPath;
        } catch (error) {
            console.error('转换MP3失败:', error);
            throw error;
        }
    }

    // 执行命令（异步、可取消、带超时）
    // command: ['yt-dlp', ...args]，opts: { timeout, maxBuffer, silent, returnStderr }
    async executeCommand(command, opts = {}) {
        const { timeout = 0, maxBuffer = 50 * 1024 * 1024, silent = false, returnStderr = false } = opts;

        return new Promise(async (resolve, reject) => {
            try {
                // 获取工具的实际可执行路径
                const toolName = command[0];
                let executablePath = await this.toolsManager.getExecutableCommand(toolName);

                if (!executablePath) {
                    console.log(`工具 ${toolName} 不可用，尝试自动下载...`);

                    try {
                        // 尝试自动下载工具
                        await this.toolsManager.downloadTool(toolName);
                        executablePath = await this.toolsManager.getExecutableCommand(toolName);

                        if (!executablePath) {
                            // 获取诊断信息
                            const diagnosis = await this.toolsManager.diagnoseToolStatus(toolName);
                            let errorMsg = `下载失败：${toolName}工具不可用。`;

                            if (diagnosis.issues.length > 0) {
                                errorMsg += `问题：${diagnosis.issues.join(', ')}。`;
                            }

                            if (diagnosis.recommendations.length > 0) {
                                errorMsg += `建议：${diagnosis.recommendations.join(', ')}。`;
                            }

                            // 如果是ffmpeg，提供特殊的错误消息
                            if (toolName === 'ffmpeg') {
                                errorMsg = '下载失败：ffmpeg工具不可用。请打开"检查控制台"并点击"强制重新下载工具"按钮，然后重试。';
                            }

                            reject(new Error(errorMsg));
                            return;
                        }

                        console.log(`工具 ${toolName} 自动下载成功: ${executablePath}`);
                    } catch (downloadError) {
                        console.error(`自动下载 ${toolName} 失败:`, downloadError);
                        reject(new Error(`工具 ${toolName} 不可用且自动下载失败: ${downloadError.message}`));
                        return;
                    }
                }

                // 使用实际的可执行路径
                const actualCommand = [executablePath, ...command.slice(1)];
                console.log('执行命令:', actualCommand.join(' '));

                const child = spawn(actualCommand[0], actualCommand.slice(1), {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true
                });

                // 注册到下载进程集合（用于取消下载）
                this.downloadProcesses.add(child);

                let stdout = '';
                let stderr = '';
                let killed = false;
                let timer = null;

                if (timeout > 0) {
                    timer = setTimeout(() => {
                        killed = true;
                        try { child.kill(); } catch (e) { /* 忽略 */ }
                    }, timeout);
                }

                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                    if (stdout.length > maxBuffer) {
                        killed = true;
                        try { child.kill(); } catch (e) { /* 忽略 */ }
                    }
                    // 发送进度到渲染进程（dump-json 等静默场景不发送）
                    if (!silent && this.mainWindow) {
                        this.mainWindow.webContents.send('download-progress', {
                            type: 'stdout',
                            data: data.toString()
                        });
                    }
                });

                child.stderr.on('data', (data) => {
                    stderr += data.toString();
                    if (stderr.length > maxBuffer) {
                        killed = true;
                        try { child.kill(); } catch (e) { /* 忽略 */ }
                    }
                });

                child.on('close', (code) => {
                    if (timer) clearTimeout(timer);
                    this.downloadProcesses.delete(child);

                    if (this.downloadCancelRequested) {
                        reject(new Error('下载已取消'));
                        return;
                    }

                    if (code === 0) {
                        resolve(returnStderr ? { stdout, stderr } : stdout);
                    } else if (killed && timeout > 0 && code !== 0) {
                        reject(new Error('命令执行超时'));
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${stderr}`));
                    }
                });

                child.on('error', (error) => {
                    if (timer) clearTimeout(timer);
                    this.downloadProcesses.delete(child);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    // ==================== 音频转歌词（whisper） ====================

    // 音频 → LRC 歌词：ffmpeg 转 16k 单声道 wav → whisper 自动语言识别 → LRC
    async transcribeSong(songId) {
        const song = await this.database.getSongById(songId);
        if (!song) {
            throw new Error('内容不存在');
        }
        if (!fsSync.existsSync(song.path)) {
            throw new Error('音频文件不存在');
        }

        // 1. 检查 whisper 工具（首次使用时下载，约 2MB）
        let whisperPath = await this.toolsManager.getExecutableCommand('whisper');
        if (!whisperPath) {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('transcribe-status', '正在下载语音识别工具（仅首次）...');
            }
            await this.toolsManager.downloadTool('whisper', (progress, downloaded, total) => {
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('whisper-model-progress', {
                        modelKey: '_tool', progress, downloaded, total
                    });
                }
            });
            whisperPath = await this.toolsManager.getExecutableCommand('whisper');
            if (!whisperPath) {
                throw new Error('语音识别工具不可用，请到设置 → AI 歌词识别 中重试下载');
            }
        }

        // 2. 检查模型（模型由用户选择下载）
        const modelKey = await this.database.getSetting('whisper_model', 'base');
        if (!(await this.toolsManager.isWhisperModelDownloaded(modelKey))) {
            return { success: false, modelMissing: true, modelKey };
        }
        const modelPath = this.toolsManager.getWhisperModelPath(modelKey);

        // 3. ffmpeg 转换为 16kHz 单声道 wav（whisper 要求）
        if (this.mainWindow) {
            this.mainWindow.webContents.send('transcribe-status', '正在准备音频...');
        }
        const cleanTitle = this.cleanFileName(song.title);
        const wavPath = path.join(this.tempDir, `${cleanTitle}_temp_transcribe.wav`);
        const outPrefix = path.join(this.tempDir, `${cleanTitle}_temp_transcribe`);
        await this.executeCommand(
            ['ffmpeg', '-i', song.path, '-ar', '16000', '-ac', '1', '-y', wavPath],
            { silent: true }
        );

        // 4. whisper 识别（-l auto 多语言自动检测；-olrc 输出歌词；-pp 输出进度百分比）
        try {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('transcribe-status', '正在识别（耗时取决于音频长度与模型规格）...');
            }
            this.downloadCancelRequested = false;
            await this.executeCommand(
                ['whisper', '-m', modelPath, '-f', wavPath, '-l', 'auto', '-olrc', '-of', outPrefix, '-pp'],
                { silent: false }
            );

            // 5. 读取 LRC 结果
            const lrcPath = outPrefix + '.lrc';
            const lrcContent = await fs.readFile(lrcPath, 'utf8');

            if (!lrcContent.trim()) {
                return { success: false, error: '未能识别出内容（音频可能没有人声）' };
            }

            return { success: true, lrc: lrcContent };
        } finally {
            // 6. 清理临时文件（wav + lrc）
            await fs.unlink(wavPath).catch(() => {});
            await fs.unlink(outPrefix + '.lrc').catch(() => {});
            await fs.unlink(outPrefix + '.txt').catch(() => {});
            await fs.unlink(outPrefix + '.srt').catch(() => {});
            await fs.unlink(outPrefix + '.json').catch(() => {});
            await fs.unlink(outPrefix + '.tsv').catch(() => {});
        }
    }

    // 清理文件名
    cleanFileName(fileName) {
        if (!fileName) return 'untitled';
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    // 音频元数据提取
    async extractAudioMetadata(filePath) {
        try {
            const metadata = await parseFile(filePath);
            const common = metadata.common || {};
            const format = metadata.format || {};

            return {
                title: common.title || path.basename(filePath, path.extname(filePath)),
                artist: common.artist || common.albumartist || '',
                album: common.album || '',
                duration: Math.round(format.duration) || 0,
                path: filePath,
                source_url: null,
                thumbnail: null,
                video_path: null
            };
        } catch (error) {
            console.error('提取音频元数据失败:', filePath, error);
            // 如果提取失败，返回基本信息
            return {
                title: path.basename(filePath, path.extname(filePath)),
                artist: '',
                album: '',
                duration: 0,
                path: filePath,
                source_url: null,
                thumbnail: null,
                video_path: null
            };
        }
    }

    // 分析歌曲音量（EBU R128）
    async analyzeSongVolume(songId, targetLufs = -16) {
        try {
            // 获取歌曲信息
            const song = await this.database.getSongById(songId);
            if (!song) {
                throw new Error('歌曲不存在');
            }

            console.log(`开始分析音量: ${song.title} (${song.path})`);

            // 检查文件是否存在
            if (!fsSync.existsSync(song.path)) {
                throw new Error('音频文件不存在');
            }

            // 使用 FFmpeg 的 ebur128 滤镜分析音量
            // 异步执行（execSync 会阻塞整个主进程，导致界面卡死）
            const result = await this.executeCommand(
                ['ffmpeg', '-i', song.path, '-filter_complex', 'ebur128', '-f', 'null', '-'],
                { maxBuffer: 50 * 1024 * 1024, silent: true, returnStderr: true }
            );

            // 合并 stdout/stderr（ffmpeg 的 ebur128 输出主要在 stderr）
            const fullOutput = ((result && result.stdout) || '') + '\n' + ((result && result.stderr) || '');

            console.log('FFmpeg 输出长度:', fullOutput.length);

            // 解析 FFmpeg 输出，提取 Integrated loudness 值
            // 格式：
            // Summary:
            //   Integrated loudness:
            //     I:          -6.8 LUFS

            let integratedLoudness = null;

            // 使用更精确的正则表达式匹配 Summary 部分
            const summaryPattern = /Summary:[\s\S]*?Integrated loudness:[\s\S]*?I:\s+([-\d]+\.?\d*)\s+LUFS/is;
            const match = fullOutput.match(summaryPattern);

            if (match && match[1]) {
                integratedLoudness = parseFloat(match[1]);
                console.log('✓ 解析成功:', integratedLoudness, 'LUFS');
            } else {
                console.error('❌ 正则匹配失败');
                console.log('--- 调试信息 ---');
                console.log('包含 Summary:', fullOutput.includes('Summary'));
                console.log('包含 Integrated loudness:', fullOutput.includes('Integrated loudness'));
                console.log('包含 "I:":', fullOutput.includes('I:'));

                // 尝试简单的查找
                const simpleMatch = fullOutput.match(/I:\s+(-?\d+\.?\d*)\s+LUFS/i);
                if (simpleMatch) {
                    integratedLoudness = parseFloat(simpleMatch[1]);
                    console.log('✓ 简单模式成功:', integratedLoudness);
                }
            }

            if (integratedLoudness === null || isNaN(integratedLoudness)) {
                console.error('❌ 无法解析音量分析结果');
                console.log('--- 输出内容（最后2000字符）---');
                console.log(fullOutput.slice(-2000));
                console.log('--- 输出结束 ---');
                return {
                    success: false,
                    error: '无法解析音量分析结果',
                    songId: songId
                };
            }

            // 计算增益值（目标响度 - 实际响度）
            const volumeGain = targetLufs - integratedLoudness;

            console.log(`音量分析完成:`);
            console.log(`  实际响度: ${integratedLoudness.toFixed(1)} LUFS`);
            console.log(`  目标响度: ${targetLufs} LUFS`);
            console.log(`  需要增益: ${volumeGain > 0 ? '+' : ''}${volumeGain.toFixed(1)} dB`);

            // 更新数据库（保存增益值和原始响度）
            await this.database.updateSongVolumeGain(songId, volumeGain, integratedLoudness);

            return {
                success: true,
                songId: songId,
                integratedLoudness: integratedLoudness,
                volumeGain: volumeGain,
                targetLufs: targetLufs
            };

        } catch (error) {
            console.error('音量分析失败:', error);
            return {
                success: false,
                error: error.message,
                songId: songId
            };
        }
    }



    // 删除歌曲及其文件
    async deleteSongWithFile(songId) {
        try {
            // 首先获取歌曲信息
            const song = await this.database.getSongById(songId);
            
            if (!song) {
                throw new Error('歌曲不存在');
            }
            
            console.log('准备删除歌曲:', {
                id: song.id,
                title: song.title,
                path: song.path,
                thumbnail: song.thumbnail
            });

            // 播放停止由渲染进程在调用删除前自行处理（音频元素在渲染进程，能释放文件句柄）
            
            // 删除音频文件
            let fileDeleteResult = false;
            if (song.path) {
                try {
                    // 检查文件是否存在
                    const exists = await this.fileExists(song.path);
                    console.log('文件是否存在:', exists, song.path);
                    
                    if (exists) {
                        // 尝试多次删除，处理文件被占用的情况
                        let deleteAttempts = 0;
                        const maxAttempts = 3;
                        
                        while (deleteAttempts < maxAttempts) {
                            try {
                                await fs.unlink(song.path);
                                console.log(`✅ 已删除音频文件: ${song.path}`);
                                fileDeleteResult = true;
                                break;
                            } catch (unlinkError) {
                                deleteAttempts++;
                                console.warn(`删除文件失败，尝试次数: ${deleteAttempts}/${maxAttempts}`, unlinkError.message);
                                
                                if (deleteAttempts < maxAttempts) {
                                    // 等待一段时间后重试
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                } else {
                                    throw unlinkError;
                                }
                            }
                        }
                    } else {
                        console.log(`⚠️ 文件不存在，跳过删除: ${song.path}`);
                        // 文件不存在也算删除成功
                        fileDeleteResult = true;
                    }
                } catch (error) {
                    console.error('❌ 删除音频文件失败:', error);
                    // 如果是权限问题或文件被占用，尝试标记为待删除
                    if (error.code === 'EBUSY' || error.code === 'EACCES') {
                        console.log('文件可能被占用，将在应用重启后重试删除');
                        // 可以在这里实现一个待删除文件列表的机制
                    }
                }
            } else {
                console.log('⚠️ 歌曲路径为空');
            }
            
            // 删除数据库记录
            const result = await this.database.removeSong(songId);
            console.log('数据库删除结果:', result);
            
            // 删除对应的歌词文件
            try {
                await this.lyricsManager.deleteLyrics(song.title);
                console.log(`✅ 已删除歌词文件: ${song.title}`);
            } catch (error) {
                console.error('❌ 删除歌词文件失败:', error);
            }
            
            // 删除缩略图文件
            let thumbnailDeleteResult = false;
            if (song.thumbnail) {
                try {
                    thumbnailDeleteResult = await this.deleteThumbnail(song.thumbnail, song.title);
                } catch (error) {
                    console.error('❌ 删除缩略图失败:', error);
                }
            }
            
            // 返回详细的删除结果
            return {
                success: result,
                fileDeleted: fileDeleteResult,
                thumbnailDeleted: thumbnailDeleteResult,
                databaseDeleted: result,
                songPath: song.path,
                thumbnailPath: song.thumbnail
            };
            
        } catch (error) {
            console.error('❌ 删除歌曲失败:', error);
            throw error;
        }
    }

    // 检查文件是否存在
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 检查歌曲文件状态
    async checkSongsFileStatus() {
        const songs = await this.database.getAllSongs();
        const missingFiles = [];
        for (const song of songs) {
            if (song.path) {
                try {
                    const exists = await this.fileExists(song.path);
                    if (!exists) {
                        missingFiles.push({
                            id: song.id,
                            title: song.title,
                            path: song.path
                        });
                    }
                } catch (error) {
                    console.error('检查文件状态失败:', song.path, error);
                    missingFiles.push({
                        id: song.id,
                        title: song.title,
                        path: song.path,
                        error: error.message
                    });
                }
            }
        }
        return missingFiles;
    }

    // 清理缺失的歌曲文件
    async cleanMissingSongs() {
        const missingFiles = await this.checkSongsFileStatus();
        let cleanedCount = 0;
        
        for (const missing of missingFiles) {
            console.log(`清理缺失文件记录: ${missing.title} - ${missing.path}`);
            try {
                // 删除数据库记录，而不是删除文件
                await this.database.removeSong(missing.id);
                console.log(`✅ 已删除数据库记录: ${missing.title}`);
                cleanedCount++;
            } catch (error) {
                console.error('清理数据库记录失败:', missing.title, error);
            }
        }
        
        return {
            totalMissing: missingFiles.length,
            cleanedCount: cleanedCount,
            missingFiles: missingFiles
        };
    }

    // 检查单个文件状态
    async checkFileStatus(filePath) {
        try {
            const exists = await this.fileExists(filePath);
            let result = {
                filePath: filePath,
                exists: exists,
                error: null
            };
            
            if (exists) {
                try {
                    const stats = await fs.stat(filePath);
                    result.size = stats.size;
                    result.modifiedTime = stats.mtime;
                    result.createdTime = stats.birthtime;
                } catch (error) {
                    console.error('获取文件详细信息失败:', error);
                    result.error = `无法获取文件详细信息: ${error.message}`;
                }
            }
            
            return result;
        } catch (error) {
            return {
                filePath: filePath,
                exists: false,
                error: error.message
            };
        }
    }

    // 清理孤立的音乐文件和缩略图（启动时执行）
    async cleanupOrphanedFiles() {
        try {
            console.log('开始清理孤立文件...');
            
            // 获取数据库中的所有歌曲
            const songs = await this.database.getAllSongs();
            const dbPaths = new Set(songs.map(song => song.path).filter(path => path));
            const dbThumbnails = new Set();
            
            // 收集所有有效的缩略图路径
            songs.forEach(song => {
                if (song.thumbnail) {
                    if (song.thumbnail.startsWith('/') || song.thumbnail.includes(':\\')) {
                        // 本地缩略图路径
                        dbThumbnails.add(song.thumbnail);
                    } else if (song.thumbnail.startsWith('http')) {
                        // 根据URL生成可能的本地路径
                        const cleanTitle = this.cleanFileName(song.title);
                        const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
                        possibleExtensions.forEach(ext => {
                            dbThumbnails.add(path.join(this.thumbnailsDir, `${cleanTitle}${ext}`));
                        });
                    }
                }
            });
            
            let totalCleanedCount = 0;
            
            // 清理孤立的音频文件
            try {
                const musicFiles = await fs.readdir(this.musicDir);
                const orphanedMusicFiles = [];
                
                for (const file of musicFiles) {
                    const filePath = path.join(this.musicDir, file);
                    
                    // 检查是否是音频文件
                    if (this.isAudioFile(file) && !dbPaths.has(filePath)) {
                        orphanedMusicFiles.push(filePath);
                    }
                }
                
                // 删除孤立的音频文件
                for (const orphanedFile of orphanedMusicFiles) {
                    try {
                        await fs.unlink(orphanedFile);
                        console.log(`✅ 已删除孤立音频文件: ${orphanedFile}`);
                        totalCleanedCount++;
                    } catch (error) {
                        console.error(`❌ 删除孤立音频文件失败: ${orphanedFile}`, error);
                    }
                }
            } catch (error) {
                console.warn('扫描音乐目录失败:', error);
            }
            
            // 清理孤立的缩略图文件
            try {
                if (await this.fileExists(this.thumbnailsDir)) {
                    const thumbnailFiles = await fs.readdir(this.thumbnailsDir);
                    const orphanedThumbnails = [];
                    
                    for (const file of thumbnailFiles) {
                        const filePath = path.join(this.thumbnailsDir, file);
                        
                        // 检查是否是图片文件且不在数据库中
                        if (this.isImageFile(file) && !dbThumbnails.has(filePath)) {
                            orphanedThumbnails.push(filePath);
                        }
                    }
                    
                    // 删除孤立的缩略图文件
                    for (const orphanedThumbnail of orphanedThumbnails) {
                        try {
                            await fs.unlink(orphanedThumbnail);
                            console.log(`✅ 已删除孤立缩略图: ${orphanedThumbnail}`);
                            totalCleanedCount++;
                        } catch (error) {
                            console.error(`❌ 删除孤立缩略图失败: ${orphanedThumbnail}`, error);
                        }
                    }
                }
            } catch (error) {
                console.warn('扫描缩略图目录失败:', error);
            }
            
            if (totalCleanedCount > 0) {
                console.log(`✨ 清理完成，删除了 ${totalCleanedCount} 个孤立文件`);
            } else {
                console.log('✅ 没有发现孤立文件');
            }
            
        } catch (error) {
            console.error('清理孤立文件失败:', error);
        }
    }

    // 判断是否是音频文件
    isAudioFile(filename) {
        const audioExtensions = ['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.wma'];
        const ext = path.extname(filename).toLowerCase();
        return audioExtensions.includes(ext);
    }

    // 判断是否是图片文件
    isImageFile(filename) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const ext = path.extname(filename).toLowerCase();
        return imageExtensions.includes(ext);
    }

    // 删除缩略图文件
    async deleteThumbnail(thumbnailPath, songTitle) {
        try {
            // 如果是URL，说明缩略图存储在本地thumbnails目录
            if (thumbnailPath.startsWith('http')) {
                // 根据歌曲标题生成本地缩略图路径
                const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
                const cleanTitle = this.cleanFileName(songTitle);
                
                for (const ext of possibleExtensions) {
                    const localPath = path.join(this.thumbnailsDir, `${cleanTitle}${ext}`);
                    if (await this.fileExists(localPath)) {
                        await fs.unlink(localPath);
                        console.log(`✅ 已删除缩略图文件: ${localPath}`);
                        return true;
                    }
                }
                console.log(`⚠️ 未找到本地缩略图文件: ${cleanTitle}`);
                return false;
            } else if (thumbnailPath.startsWith('/') || thumbnailPath.includes(':\\')) {
                // 绝对路径，直接删除
                if (await this.fileExists(thumbnailPath)) {
                    await fs.unlink(thumbnailPath);
                    console.log(`✅ 已删除缩略图文件: ${thumbnailPath}`);
                    return true;
                } else {
                    console.log(`⚠️ 缩略图文件不存在: ${thumbnailPath}`);
                    return false;
                }
            } else {
                console.log(`⚠️ 无法识别的缩略图路径格式: ${thumbnailPath}`);
                return false;
            }
        } catch (error) {
            console.error('删除缩略图失败:', error);
            throw error;
        }
    }

    // 下载缩略图
    async downloadThumbnail(thumbnailUrl, songTitle) {
        try {
            const https = require('https');
            const http = require('http');
            
            // 创建thumbnails目录
            await fs.mkdir(this.thumbnailsDir, { recursive: true });
            
            // 生成本地文件名
            const extension = path.extname(new URL(thumbnailUrl).pathname) || '.jpg';
            const filename = `${this.cleanFileName(songTitle)}${extension}`;
            const localPath = path.join(this.thumbnailsDir, filename);
            
            // 选择合适的协议
            const client = thumbnailUrl.startsWith('https:') ? https : http;
            
            return new Promise((resolve, reject) => {
                const request = client.get(thumbnailUrl, (response) => {
                    if (response.statusCode === 200) {
                        const writeStream = require('fs').createWriteStream(localPath);
                        response.pipe(writeStream);
                        
                        writeStream.on('finish', () => {
                            console.log(`✅ 缩略图保存成功: ${localPath}`);
                            resolve(localPath);
                        });
                        
                        writeStream.on('error', (error) => {
                            console.error('写入缩略图文件失败:', error);
                            reject(error);
                        });
                    } else {
                        reject(new Error(`下载缩略图失败，状态码: ${response.statusCode}`));
                    }
                });
                
                request.on('error', (error) => {
                    console.error('下载缩略图请求失败:', error);
                    reject(error);
                });
                
                request.setTimeout(10000, () => {
                    request.destroy();
                    reject(new Error('下载缩略图超时'));
                });
            });
        } catch (error) {
            console.error('下载缩略图失败:', error);
            throw error;
        }
    }

    // 清理资源
    async cleanup() {
        try {
            console.log('开始清理应用资源...');
            
            // 关闭所有窗口
            if (this.lyricsWindow && !this.lyricsWindow.isDestroyed()) {
                this.lyricsWindow.destroy();
                this.lyricsWindow = null;
            }
            
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.destroy();
                this.mainWindow = null;
            }
            
            // 关闭数据库连接
            if (this.database && this.database.isInitialized) {
                await this.database.close();
            }
            
            console.log('应用资源清理完成');
        } catch (error) {
            console.error('清理过程中出现错误:', error);
            throw error;
        }
    }
}

// 创建应用实例
const app_instance = new BiliMusicPlayer();

module.exports = app_instance;
