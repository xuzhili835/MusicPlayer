const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { execSync, spawn } = require('child_process');
const { parseFile } = require('music-metadata');
const Database = require('./database.js');
const LyricsManager = require('./lyrics.js');
const ToolsManager = require('./tools-manager.js');

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
        
        // 初始化歌词管理器，传入正确的路径
        this.lyricsManager = new LyricsManager(this.lyricsDir, this.tempDir);
        
        // 初始化工具管理器
        this.toolsManager = new ToolsManager();
        
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
            
            // 启动时清理遗留的孤立文件
            await this.cleanupOrphanedFiles();
            
            this.createMainWindow();
            this.setupIPC();
            
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
        app.on('will-quit', async (event) => {
            if (this.database && this.database.isInitialized) {
                event.preventDefault();
                
                try {
                    await this.database.close();
                    console.log('应用正常退出');
                    setTimeout(() => process.exit(0), 1000); // 给予1秒时间完成清理
                } catch (error) {
                    console.error('退出时清理失败:', error);
                    process.exit(1);
                }
            }
        });
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
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            title: 'Sakura Echo - 声织四季，瓣落成音',
            show: false,
            titleBarStyle: 'default'
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
                    const { ipcRenderer } = require('electron');
                    
                    let isDragging = false;
                    let startX, startY;
                    
                    // 关闭按钮事件
                    document.getElementById('close-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        ipcRenderer.send('lyrics-window-close');
                    });
                    
                    // 拖动功能
                    const lyricsContainer = document.getElementById('lyrics-container');
                    
                    lyricsContainer.addEventListener('mousedown', (e) => {
                        isDragging = true;
                        startX = e.clientX;
                        startY = e.clientY;
                        ipcRenderer.send('lyrics-window-drag-start', {
                            startX: e.screenX,
                            startY: e.screenY
                        });
                    });
                    
                    document.addEventListener('mousemove', (e) => {
                        if (isDragging) {
                            ipcRenderer.send('lyrics-window-drag-move', {
                                screenX: e.screenX,
                                screenY: e.screenY
                            });
                        }
                    });
                    
                    document.addEventListener('mouseup', () => {
                        if (isDragging) {
                            isDragging = false;
                            ipcRenderer.send('lyrics-window-drag-end');
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

        // 清理功能
        ipcMain.handle('cleanup-orphaned-files', async () => {
            try {
                await this.cleanupOrphanedFiles();
                return { success: true };
            } catch (error) {
                console.error('清理孤立文件失败:', error);
                return { success: false, error: error.message };
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

        // 播放器控制
        ipcMain.handle('player-stop-current', async (event, songId) => {
            try {
                await this.stopPlayingIfCurrentSong(songId);
                return { success: true };
            } catch (error) {
                console.error('停止播放失败:', error);
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

        ipcMain.handle('file-open-external', async (event, url) => {
            shell.openExternal(url);
        });

        // 下载功能
        ipcMain.handle('download-bilibili-video', async (event, url, options = {}) => {
            return await this.downloadBilibiliVideo(url, options);
        });

        ipcMain.handle('download-get-video-info', async (event, url) => {
            return await this.getVideoInfo(url);
        });

        // 歌词功能
        ipcMain.handle('lyrics-download', async (event, url, title) => {
            return await this.lyricsManager.downloadLyrics(url, title);
        });

        ipcMain.handle('lyrics-search', async (event, query) => {
            return await this.lyricsManager.searchLyrics(query);
        });

        ipcMain.handle('lyrics-get', async (event, title) => {
            return await this.lyricsManager.getLyrics(title);
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
            return await this.database.removeSong(songId);
        });
        
        ipcMain.handle('database-remove-song', async (event, songId) => {
            return await this.database.removeSong(songId);
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
            const command = `"${ytdlpPath}" --dump-json --no-playlist "${url}"`;
            console.log(`执行命令: ${command}`);
            
            const output = execSync(command, { 
                encoding: 'utf8',
                timeout: 30000,  // 30秒超时
                maxBuffer: 1024 * 1024 * 10  // 10MB缓冲区
            });
            
            const videoInfo = JSON.parse(output);
            
            return {
                title: videoInfo.title,
                uploader: videoInfo.uploader,
                duration: videoInfo.duration,
                thumbnail: videoInfo.thumbnail,
                description: videoInfo.description
            };
        } catch (error) {
            console.error('获取视频信息失败:', error);
            
            // 提供更详细的错误信息
            let errorMessage = '获取视频信息失败：';
            
            if (error.message.includes('权限')) {
                errorMessage += '权限不足，请检查防病毒软件设置。';
            } else if (error.message.includes('不是内部或外部命令')) {
                errorMessage += 'yt-dlp工具未找到或无法执行。';
            } else if (error.message.includes('timeout')) {
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
        try {
            console.log('开始下载视频:', url);
            
            // 获取视频信息
            const videoInfo = await this.getVideoInfo(url);
            const cleanTitle = this.cleanFileName(videoInfo.title);
            
            // 临时文件路径
            const tempAudioPath = path.join(this.tempDir, `${cleanTitle}_temp.%(ext)s`);
            
            // 下载最好质量的音频
            const downloadCommand = [
                'yt-dlp',
                '--extract-audio',
                '--audio-format', 'best',
                '--audio-quality', '0',
                '--output', tempAudioPath,
                '--no-playlist',
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
            
            // 转换为MP3
            const finalPath = await this.convertToMP3(tempFilePath, cleanTitle);
            
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
            
            // 尝试下载歌词
            if (options.downloadLyrics) {
                try {
                    await this.lyricsManager.downloadLyrics(url, videoInfo.title);
                } catch (error) {
                    console.log('下载歌词失败:', error);
                }
            }
            
            return {
                success: true,
                song: { ...songData, id: songId }
            };
            
        } catch (error) {
            console.error('下载视频失败:', error);
            
            // 提供用户友好的错误信息
            let errorMessage = '下载失败：';
            
            if (error.message.includes('ffmpeg')) {
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

    // 执行命令
    async executeCommand(command) {
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
                
                const process = spawn(actualCommand[0], actualCommand.slice(1), {
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                
                let stdout = '';
                let stderr = '';
                
                process.stdout.on('data', (data) => {
                    stdout += data.toString();
                    // 发送进度到渲染进程
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('download-progress', {
                            type: 'stdout',
                            data: data.toString()
                        });
                    }
                });
                
                process.stderr.on('data', (data) => {
                    stderr += data.toString();
                    console.log('Process stderr:', data.toString());
                });
                
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${stderr}`));
                    }
                });
                
                process.on('error', (error) => {
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
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
            
            // 检查是否是正在播放的歌曲，如果是则停止播放
            await this.stopPlayingIfCurrentSong(songId);
            
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

    // 检查并停止正在播放的歌曲
    async stopPlayingIfCurrentSong(songId) {
        try {
            // 通知渲染进程检查并停止播放
            if (this.mainWindow) {
                const isCurrentlyPlaying = await this.mainWindow.webContents.executeJavaScript(`
                    (function() {
                        if (window.player && window.player.currentSong && window.player.currentSong.id === ${songId}) {
                            if (window.player.audio && !window.player.audio.paused) {
                                window.player.audio.pause();
                                window.player.audio.src = '';
                                window.player.audio.load();
                                console.log('已停止播放要删除的歌曲');
                                return true;
                            }
                            // 清除当前歌曲信息
                            window.player.currentSong = null;
                            window.player.currentIndex = -1;
                            if (window.player.updateCurrentSongInfo) {
                                window.player.updateCurrentSongInfo();
                            }
                        }
                        return false;
                    })();
                `);
                
                if (isCurrentlyPlaying) {
                    console.log('✅ 已停止正在播放的歌曲，释放文件句柄');
                    // 等待一段时间确保文件句柄被释放
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.warn('停止播放歌曲时出错:', error);
        }
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
