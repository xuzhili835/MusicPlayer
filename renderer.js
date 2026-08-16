// 渲染进程主逻辑：MusicPlayer 核心（状态/初始化/事件接线）
// 各功能模块以 mixin 形式挂载（见 src/ui/*.js）

class MusicPlayer {
    constructor() {
        // 播放状态
        this.audio = null;
        this.currentSong = null;
        this.playlist = [];        // 当前视图的数据
        this.allSongs = [];        // 全部内容（分类过滤的数据源）
        this.currentIndex = 0;
        this.isPlaying = false;
        this.volume = 50;
        this.playMode = 'sequence'; // sequence | shuffle | single（三态，单按钮切换）

        // 视图状态
        this.currentView = 'all-songs';
        this.currentPlaylistId = null;
        this.currentPlaylistName = null;
        this.isSearchResult = false;

        // 歌词
        this.currentLyrics = null;
        this.lyricsInterval = null;

        // 倍速 / A-B 复读（听力特性）
        this.playbackRate = 1;
        this.loopA = null;
        this.loopB = null;

        // 随机播放队列
        this.shuffleOrder = [];
        this.shufflePosition = -1;

        // 进度条拖拽
        this.progressDragging = false;

        // 睡眠定时
        this.sleepTimerId = null;
        this.sleepTimerMinutes = 0;
        this.stopAfterEnd = false;

        this.initializePlayer();
    }

    // 初始化播放器
    async initializePlayer() {
        try {
            logger.info('播放器初始化开始');

            await this.waitForDOM();

            this.audio = document.getElementById('audio-player');
            if (!this.audio) {
                throw new Error('Audio element not found');
            }

            this.loadSettings();

            await this.initializeUI();

            this.setupEventListeners();
            this.setupAudioEvents();

            logger.info('事件监听器设置完成');

            // 延迟刷新一次内容库，确保 UI 完全就绪
            setTimeout(async () => {
                try {
                    await this.loadMusicLibrary();
                } catch (error) {
                    logger.error('内容库加载失败:', error);
                }
            }, 500);

            logger.info('播放器初始化完成');
        } catch (error) {
            logger.error('播放器初始化失败:', error);
            this.showMessage('播放器初始化失败，请重启应用', 'error');

            if (!this.retryInitialization) {
                this.retryInitialization = true;
                setTimeout(() => {
                    this.initializePlayer();
                }, 2000);
            }
        }
    }

    // 等待DOM加载
    waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                setTimeout(resolve, 0);
            } else if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(resolve, 100);
                });
            } else {
                window.addEventListener('load', () => {
                    setTimeout(resolve, 50);
                });
            }
        });
    }

    // 设置事件监听器
    setupEventListeners() {
        // 窗口控制按钮
        this.bindClick('window-minimize-btn', () => electronAPI.window.minimize());
        this.bindClick('window-maximize-btn', () => electronAPI.window.maximize());
        this.bindClick('window-close-btn', () => electronAPI.window.close());

        // 隐私模式按钮（头部，与随机播放并排）
        this.bindClick('privacy-btn', () => PrivacyMode.toggle());

        // 搜索功能（仅当首次绑定失败时才重试）
        if (!this.setupSearchInput()) {
            setTimeout(() => {
                this.setupSearchInput();
            }, 1000);
        }

        // 侧边栏导航（事件委托，覆盖静态项+功能按钮）
        const sidebarNav = document.querySelector('.sidebar-nav');
        if (sidebarNav) {
            sidebarNav.addEventListener('click', (e) => {
                const navItem = e.target.closest('.nav-item');
                if (!navItem) return;
                e.preventDefault();

                if (navItem.dataset.view) {
                    this.switchView(navItem.dataset.view);
                } else if (navItem.id) {
                    switch (navItem.id) {
                        case 'add-files-btn':
                            this.selectLocalFiles();
                            break;
                        case 'download-btn':
                            this.showDownloadDialog();
                            break;
                        case 'lyrics-window-btn':
                            this.toggleLyricsWindow();
                            break;
                        case 'theme-toggle-btn':
                            this.toggleTheme();
                            break;
                        case 'settings-btn':
                            this.showSettingsDialog();
                            break;
                    }
                }
            });
        }

        // 头部操作
        this.bindClick('shuffle-all-btn', () => this.shuffleAll());
        this.bindClick('create-playlist-btn', () => this.showCreatePlaylistDialog());

        // 播放控制按钮
        this.bindClick('play-btn', () => this.togglePlay());
        this.bindClick('prev-btn', () => this.previousSong());
        this.bindClick('next-btn', () => this.nextSong());
        this.bindClick('play-mode-btn', () => this.togglePlayMode());

        // 听力特性：倍速 / A-B 复读 / 睡眠定时
        // 注意 stopPropagation：点击事件若冒泡到 document 的弹出菜单关闭器，
        // 菜单刚打开就会被立即关掉（表现为"点了没反应"）
        this.bindClick('speed-btn', (e) => { e.stopPropagation(); this.showSpeedMenu(e.currentTarget); });
        this.bindClick('ab-btn', () => this.toggleABLoop());
        this.bindClick('sleep-timer-btn', (e) => { e.stopPropagation(); this.showSleepTimerMenu(e.currentTarget); });
        this.setupProgressDrag();

        // 点击空白处关闭弹出菜单
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('popover-menu');
            if (menu && !menu.contains(e.target)) {
                this.closePopoverMenu();
            }
        });

        // 音量控制
        this.bindClick('volume-btn', () => this.toggleMute());
        const volumeRange = document.getElementById('volume-range');
        if (volumeRange) {
            volumeRange.addEventListener('input', (e) => {
                if (!e.target || e.target.value === undefined) return;
                this.setVolume(parseInt(e.target.value));
            });
        }

        // 进度条
        const progressContainer = document.getElementById('progress-bar-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                this.seekTo(e);
            });
        }

        // 对话框事件
        this.setupDialogEvents();

        // 全局快捷键
        this.setupGlobalShortcuts();
    }

    // 设置搜索输入框（幂等：重复调用不会重复绑定事件）
    setupSearchInput() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) {
            console.warn('搜索框元素未找到');
            return false;
        }

        if (searchInput.dataset.bound === 'true') {
            return true;
        }
        searchInput.dataset.bound = 'true';
        searchInput.tabIndex = 0;

        searchInput.addEventListener('input', utils.debounce((e) => {
            if (!e.target || e.target.value === undefined) return;
            this.handleSearch(e.target.value);
        }, 300));

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (!e.target || e.target.value === undefined) return;
                this.handleSearch(e.target.value);
            }
        });

        searchInput.addEventListener('dblclick', (e) => {
            e.target.select();
        });

        return true;
    }

    // 绑定点击事件的辅助方法
    bindClick(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', handler);
        }
    }

    // 设置音频事件
    setupAudioEvents() {
        if (!this.audio) return;

        this.audio.addEventListener('loadstart', () => {
            this.updatePlayButton('loading');
        });

        this.audio.addEventListener('loadedmetadata', () => {
            this.updateProgress();
            this.updateTimeDisplay();
        });

        this.audio.addEventListener('canplay', () => {
            this.updatePlayButton(this.isPlaying ? 'playing' : 'paused');
        });

        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButton('playing');
            this.updateCurrentSongHighlight();
            this.startLyricsSync();
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton('paused');
            this.stopLyricsSync();
        });

        this.audio.addEventListener('timeupdate', () => {
            // 拖拽中不回写进度（避免抖动），其余时间同步
            if (!this.progressDragging) {
                this.updateProgress();
            }
            this.updateTimeDisplay();
            this.checkABLoop();
            this.updateABRegion();
            this.updateLyrics();
        });

        this.audio.addEventListener('ended', () => {
            this.handleSongEnded();
        });

        this.audio.addEventListener('error', (e) => {
            logger.error('音频播放错误:', e);
            this.showMessage('播放失败', 'error');
        });
    }

    // 设置对话框事件
    setupDialogEvents() {
        // 下载对话框
        this.bindClick('download-dialog-close', () => this.hideDownloadDialog());
        this.bindClick('download-cancel-btn', () => this.cancelDownload());
        this.bindClick('download-start-btn', () => this.startDownload());

        // 创建歌单对话框
        this.bindClick('playlist-dialog-close', () => this.hidePlaylistDialog());
        this.bindClick('playlist-cancel-btn', () => this.hidePlaylistDialog());
        this.bindClick('playlist-create-btn', () => this.createPlaylist());

        // URL输入事件（自动预览，B站 / YouTube）
        const urlInput = document.getElementById('download-url');
        if (urlInput) {
            urlInput.addEventListener('input', utils.debounce(async (e) => {
                if (!e.target || !e.target.value) return;
                const inputText = e.target.value.trim();
                const url = utils.extractMediaUrl(inputText);
                if (url && utils.isSupportedMediaUrl(url)) {
                    try {
                        await this.previewVideo(url);
                    } catch (error) {
                        logger.error('预览失败:', error);
                    }
                }
            }, 500));

            urlInput.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showInputContextMenu(e, urlInput);
            });
        }

        // 空状态按钮（事件委托：空状态内容是动态渲染的）
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            emptyState.addEventListener('click', (e) => {
                if (e.target.id === 'empty-download-btn') {
                    this.showDownloadDialog();
                } else if (e.target.id === 'empty-add-files-btn') {
                    this.selectLocalFiles();
                }
            });
        }

        // 后台下载：全局进度订阅（更新标题栏徽标）+ 徽标取消按钮
        this.setupDownloadIndicatorListeners();
        this.bindClick('download-indicator-cancel', () => this.cancelBackgroundDownload());

        // 更新检查：主进程静默检查发现新版本时弹提示
        if (electronAPI.updater && electronAPI.updater.onUpdateAvailable) {
            electronAPI.updater.onUpdateAvailable((info) => {
                this.showUpdateDialog(info);
            });
        }
    }

    // 加载用户设置
    loadSettings() {
        this.volume = storage.get('volume', 50);
        let savedPlayMode = storage.get('playMode', 'sequence');

        // 三态播放模式（兼容旧值：repeat/reverse 一律回退为顺序）
        const validModes = ['sequence', 'shuffle', 'single'];
        if (!validModes.includes(savedPlayMode)) {
            savedPlayMode = 'sequence';
        }

        this.playMode = savedPlayMode;

        this.setVolume(this.volume);
        this.updatePlayModeButtons();
        this.initPlaybackRate();
    }

    // 保存用户设置
    saveSettings() {
        storage.set('volume', this.volume);
        storage.set('playMode', this.playMode);
    }

    // 初始化界面
    async initializeUI() {
        this.currentView = 'all-songs';

        await this.loadTheme();
        await this.loadMusicLibrary();
        await this.loadPlaylistsToSidebar();

        this.updateCurrentSongInfo();
    }

    // ---------- 主题 ----------

    async loadTheme() {
        try {
            const result = await electronAPI.theme.get();
            const theme = (result && result.success && result.theme === 'light') ? 'light' : 'dark';
            this.applyTheme(theme);
        } catch (error) {
            console.error('加载主题失败:', error);
            this.applyTheme('dark');
        }
    }

    applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
        }
    }

    async toggleTheme() {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
        try {
            await electronAPI.theme.set(next);
        } catch (error) {
            console.error('保存主题失败:', error);
        }
    }

    // ---------- 消息提示 ----------

    showMessage(text, type = 'info') {
        const container = document.getElementById('message-container');
        if (!container) return;

        const message = dom.createElement('div', {
            className: `message ${type}`,
            textContent: text
        });

        container.appendChild(message);

        setTimeout(() => {
            if (message.parentNode) {
                message.parentNode.removeChild(message);
            }
        }, 3000);
    }

    // 自制确认框（替代原生 confirm，风格与应用统一）
    showConfirm({ title = '确认操作', message = '', confirmText = '确定', danger = false }) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal-content" style="width: 360px;">
                    <div class="modal-header">
                        <h3>${utils.escapeHtml(title)}</h3>
                    </div>
                    <div class="modal-body">
                        <p style="font-size: 13.5px; color: var(--text); line-height: 1.6;">${utils.escapeHtml(message)}</p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" data-role="cancel">取消</button>
                        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-role="confirm">${utils.escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            const done = (value) => {
                overlay.remove();
                resolve(value);
            };

            overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => done(false));
            overlay.querySelector('[data-role="confirm"]').addEventListener('click', () => done(true));
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') done(false);
                if (e.key === 'Enter') done(true);
            });

            document.body.appendChild(overlay);
            overlay.querySelector('[data-role="confirm"]').focus();
        });
    }

    // 刷新界面
    async refreshUI() {
        try {
            logger.info('开始刷新界面');
            this.showMessage('正在刷新界面...', 'info');

            await this.loadPlaylistsToSidebar();
            await this.refreshCurrentView();

            logger.info('界面刷新完成');
            this.showMessage('界面刷新成功', 'success');

        } catch (error) {
            logger.error('界面刷新失败:', error);
            this.showMessage('界面刷新失败: ' + error.message, 'error');
        }
    }

    // ---------- 更新提示 ----------

    showUpdateDialog(info) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="width: 380px;">
                <div class="modal-header">
                    <h3>发现新版本</h3>
                </div>
                <div class="modal-body">
                    <p style="font-size: 13.5px; color: var(--text); line-height: 1.7;">
                        当前版本 v${utils.escapeHtml(info.current)}，最新版本 <strong style="color: var(--accent);">v${utils.escapeHtml(info.remote)}</strong>。
                    </p>
                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">将打开浏览器前往下载页</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-role="later">稍后再说</button>
                    <button class="btn btn-primary" data-role="go">前往下载</button>
                </div>
            </div>
        `;

        overlay.querySelector('[data-role="later"]').addEventListener('click', () => overlay.remove());
        overlay.querySelector('[data-role="go"]').addEventListener('click', async () => {
            overlay.remove();
            try {
                await electronAPI.file.openExternal(info.url);
            } catch (error) {
                logger.error('打开下载页失败:', error);
            }
        });

        document.body.appendChild(overlay);
    }

    // 设置全局快捷键（应用内）
    setupGlobalShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+H 隐私模式（全局老板键由主进程注册）
            if (e.ctrlKey && e.shiftKey && e.key === 'H') {
                e.preventDefault();
                PrivacyMode.toggle();
                return;
            }

            // Ctrl+R 刷新界面
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.refreshUI();
            }

            // Ctrl+Shift+I / F12 打开开发者工具
            if ((e.ctrlKey && e.shiftKey && e.key === 'I') || e.key === 'F12') {
                e.preventDefault();
                if (electronAPI.window?.openDevTools) {
                    electronAPI.window.openDevTools();
                }
            }

            // 空格播放/暂停（焦点不在输入框时）
            if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
                e.preventDefault();
                this.togglePlay();
            }

            // 听力快捷键（焦点不在输入框时）：←/→ ±5s（Shift ±1s 精听）、↑/↓ 音量、[ ] \ A-B 复读
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
                switch (e.key) {
                    case 'ArrowLeft':
                        e.preventDefault();
                        this.seekBy(e.shiftKey ? -1 : -5);
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        this.seekBy(e.shiftKey ? 1 : 5);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.setVolume(this.volume + 5);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.setVolume(this.volume - 5);
                        break;
                    case '[':
                        e.preventDefault();
                        this.toggleABLoop('setA');
                        break;
                    case ']':
                        e.preventDefault();
                        this.toggleABLoop('setB');
                        break;
                    case '\\':
                        e.preventDefault();
                        this.toggleABLoop('clear');
                        break;
                }
            }
        });
    }
}

// 挂载功能模块（mixin）
Object.assign(
    MusicPlayer.prototype,
    window.PlayerUI,
    window.LibraryUI,
    window.PlaylistsUI,
    window.DownloadUI,
    window.LyricsUI,
    window.ContextMenus,
    window.DialogsUI,
    window.ListeningUI
);

// 全局实例
let player;

// 初始化
dom.ready(() => {
    logger.info('开始初始化音乐播放器');
    player = new MusicPlayer();

    window.player = player;

    // 初始化隐私模式（订阅主进程的老板键事件）
    if (window.PrivacyMode) {
        PrivacyMode.init(player);
    }
});
