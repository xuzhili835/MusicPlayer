// 页面逻辑 - 待实现

// 音乐播放器主类
class MusicPlayer {
    constructor() {
        this.audio = null;
        this.currentSong = null;
        this.playlist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.volume = 50;
        this.playMode = 'sequence'; // sequence, reverse, shuffle, single, repeat
        this.currentView = 'all-songs';
        this.currentPlaylistId = null;
        this.currentPlaylistName = null;
        this.currentLyrics = null;
        this.lyricsInterval = null;

        this.initializePlayer();
    }

    // 初始化播放器
    async initializePlayer() {
        try {
            logger.info('播放器初始化开始');
            
            // 等待DOM完全加载
            await this.waitForDOM();
            logger.info('DOM加载完成');
            
            // 获取音频元素
            this.audio = document.getElementById('audio-player');
            if (!this.audio) {
                throw new Error('Audio element not found');
            }
            logger.info('音频元素获取成功');

            // 加载用户设置
            this.loadSettings();
            logger.info('用户设置加载完成');
            
            // 初始化界面
            await this.initializeUI();
            logger.info('界面初始化完成');
            
            // 设置事件监听器
            this.setupEventListeners();
            this.setupAudioEvents();
            

            
            logger.info('事件监听器设置完成');
            
            // 延迟加载音乐库，确保UI完全准备好
            setTimeout(async () => {
                try {
                    await this.loadMusicLibrary();
                    logger.info('音乐库加载完成');
                } catch (error) {
                    logger.error('音乐库加载失败:', error);
                }
            }, 500);
            
            logger.info('播放器初始化完成');
            
            // 移除不必要的启动提示
            // setTimeout(() => {
            //     this.showMessage('提示：如果搜索框无法输入，请按 Ctrl+R 重置或打开系统维护控制台', 'info');
            // }, 2000);
        } catch (error) {
            logger.error('播放器初始化失败:', error);
            // 显示错误信息给用户
            this.showMessage('播放器初始化失败，请重启应用', 'error');
            
            // 尝试重新初始化（仅一次）
            if (!this.retryInitialization) {
                this.retryInitialization = true;
                setTimeout(() => {
                    this.initializePlayer();
                }, 2000);
            }
        }
    }

    // 等待DOM加载完成
    waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete') {
                // 如果DOM已经完全加载，等待一个微任务周期确保所有脚本都执行完毕
                setTimeout(resolve, 0);
            } else if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    // DOM内容加载完成后，再等待一个短暂的时间确保所有元素都已渲染
                    setTimeout(resolve, 100);
                });
            } else {
                // interactive状态，等待load事件
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

        // 搜索功能
        if (!this.setupSearchInput()) {
            // 如果搜索框设置失败，稍后重试
            setTimeout(() => {
                this.setupSearchInput();
            }, 1000);
        }
        
        // 搜索按钮点击事件
        this.bindClick('search-btn', () => {
            const searchInput = document.getElementById('search-input');
            if (searchInput && searchInput.value) {
                this.handleSearch(searchInput.value);
            }
        });

        // 导航菜单 - 使用事件委托处理动态添加的歌单
        const sidebarNav = document.querySelector('.sidebar-nav');
        if (sidebarNav) {
            sidebarNav.addEventListener('click', (e) => {
                const navItem = e.target.closest('.nav-item');
                if (navItem) {
                e.preventDefault();
                    
                    // 处理静态导航项
                    if (navItem.dataset.view) {
                        this.switchView(navItem.dataset.view);
                    } else if (navItem.id) {
                        // 处理功能按钮
                        switch (navItem.id) {
                            case 'add-files-btn':
                                this.selectLocalFiles();
                                break;
                            case 'lyrics-window-btn':
                                this.toggleLyricsWindow();
                                break;
                            case 'refresh-ui-btn':
                                this.refreshUI();
                                break;
                            case 'settings-btn':
                                this.showSettingsDialog();
                                break;
                        }
                    }
                    // 歌单项的点击事件在loadPlaylistsToSidebar中已经单独绑定
                }
            });
        }

        // 主要功能按钮
        this.bindClick('download-btn', () => this.showDownloadDialog());
        this.bindClick('create-playlist-btn', () => this.showCreatePlaylistDialog());
        this.bindClick('shuffle-all-btn', () => this.shuffleAll());

        // 播放控制按钮
        this.bindClick('play-btn', () => this.togglePlay());
        this.bindClick('prev-btn', () => this.previousSong());
        this.bindClick('next-btn', () => this.nextSong());
        this.bindClick('shuffle-btn', () => this.toggleShuffle());
        this.bindClick('repeat-btn', () => this.togglePlayMode());

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
        const progressContainer = document.querySelector('.progress-bar-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                this.seekTo(e);
            });
        }

        // 对话框事件
        this.setupDialogEvents();
        
        // 右键菜单
        this.setupContextMenu();
        
        // 全局快捷键
        this.setupGlobalShortcuts();
    }

    // 设置搜索输入框
    setupSearchInput() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            // 移除之前的事件监听器（如果有）
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            
            // 确保输入框是可交互的
            newSearchInput.tabIndex = 0;
            newSearchInput.removeAttribute('contenteditable'); // 移除contenteditable，这可能导致问题
            
            // 添加多种事件监听器确保输入功能正常
            newSearchInput.addEventListener('input', utils.debounce((e) => {
                if (!e.target || e.target.value === undefined) return;
                this.handleSearch(e.target.value);
            }, 300));
            
            newSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    if (!e.target || e.target.value === undefined) return;
                    this.handleSearch(e.target.value);
                }
            });
            
            // 添加焦点事件处理
            newSearchInput.addEventListener('focus', () => {
                console.log('搜索框获得焦点');
                newSearchInput.classList.add('focused');
            });
            
            newSearchInput.addEventListener('blur', () => {
                console.log('搜索框失去焦点');
                newSearchInput.classList.remove('focused');
            });
            
            // 添加点击事件确保焦点正确设置
            newSearchInput.addEventListener('click', (e) => {
                e.stopPropagation();
                if (document.activeElement !== newSearchInput) {
                    newSearchInput.focus();
                }
            });
            
            // 添加双击事件全选文本
            newSearchInput.addEventListener('dblclick', (e) => {
                e.target.select();
            });
            
            console.log('搜索框事件绑定完成');
            return true;
        } else {
            console.warn('搜索框元素未找到');
            return false;
        }
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
            this.updateProgress();
            this.updateTimeDisplay();
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
        this.bindClick('download-cancel-btn', () => this.hideDownloadDialog());
        this.bindClick('download-start-btn', () => this.startDownload());

        // 创建歌单对话框
        this.bindClick('playlist-dialog-close', () => this.hidePlaylistDialog());
        this.bindClick('playlist-cancel-btn', () => this.hidePlaylistDialog());
        this.bindClick('playlist-create-btn', () => this.createPlaylist());

        // URL输入事件
        const urlInput = document.getElementById('download-url');
        if (urlInput) {
            urlInput.addEventListener('input', utils.debounce(async (e) => {
                if (!e.target || !e.target.value) return;
                const inputText = e.target.value.trim();
                // 尝试提取B站链接
                const url = utils.extractBilibiliUrl(inputText);
                if (url && utils.isBilibiliUrl(url)) {
                    try {
                        await this.previewVideo(url);
                    } catch (error) {
                        logger.error('视频预览失败:', error);
                    }
                }
            }, 500));
            
            // 添加右键菜单支持
            urlInput.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showInputContextMenu(e, urlInput);
            });
        }

        // 空状态按钮
        this.bindClick('empty-download-btn', () => this.showDownloadDialog());
        this.bindClick('empty-add-files-btn', () => this.selectLocalFiles());
    }

    // 设置右键菜单
    setupContextMenu() {
        // 由于右键菜单是动态创建的，这里不需要预先绑定
        // 右键菜单会在renderSongsList中为每个歌曲项绑定
    }

    // 加载用户设置
    loadSettings() {
        this.volume = storage.get('volume', 50);
        let savedPlayMode = storage.get('playMode', 'sequence');
        
        // 确保播放模式有效，去掉已废弃的repeat模式
        const validModes = ['sequence', 'reverse', 'shuffle', 'single'];
        if (!validModes.includes(savedPlayMode)) {
            savedPlayMode = 'sequence';
        }
        
        this.playMode = savedPlayMode;
        
        this.setVolume(this.volume);
        this.updatePlayModeButtons();
    }

    // 保存用户设置
    saveSettings() {
        storage.set('volume', this.volume);
        storage.set('playMode', this.playMode);
    }

    // 初始化界面
    async initializeUI() {
        // 设置默认视图
        this.currentView = 'all-songs';
        
        // 加载数据
        await this.loadMusicLibrary();
        await this.loadPlaylistsToSidebar();
        
        this.updateCurrentSongInfo();
    }

    // 播放控制
    async togglePlay() {
        if (!this.audio) return;

        if (this.isPlaying) {
            this.audio.pause();
        } else {
            if (this.currentSong) {
                try {
                    await this.audio.play();
                } catch (error) {
                    logger.error('播放失败:', error);
                    this.showMessage('播放失败', 'error');
                }
            } else if (this.playlist.length > 0) {
                await this.playSong(0);
            }
        }
    }

    async playSong(index) {
        if (index < 0 || index >= this.playlist.length) return;

        this.currentIndex = index;
        this.currentSong = this.playlist[index];

        if (!this.currentSong) return;

        try {
            this.audio.src = this.currentSong.path;
            this.audio.load();

            // 应用音量补偿
            await this.applyVolumeCompensation();

            await this.audio.play();

            this.updateCurrentSongInfo();
            this.updateCurrentSongHighlight();

            // 加载歌词
            await this.loadLyrics(this.currentSong.title);

            logger.info('播放歌曲:', this.currentSong.title);
        } catch (error) {
            logger.error('播放歌曲失败:', error);
            this.showMessage('播放失败: ' + this.currentSong.title, 'error');
        }
    }

    async previousSong() {
        if (this.playlist.length === 0) return;

        const prevIndex = this.getPreviousSongIndex();
        if (prevIndex !== -1) {
            await this.playSong(prevIndex);
        }
    }

    getNextSongIndex() {
        if (this.playlist.length === 0) return -1;

        switch (this.playMode) {
            case 'shuffle':
                // 随机播放（避免重复当前歌曲）
                if (this.playlist.length === 1) return 0;
                let randomIndex;
                do {
                    randomIndex = Math.floor(Math.random() * this.playlist.length);
                } while (randomIndex === this.currentIndex);
                return randomIndex;
            
            case 'reverse':
                // 倒序播放
                return this.currentIndex > 0 ? this.currentIndex - 1 : this.playlist.length - 1;
            
            case 'sequence':
            case 'single':
            default:
                // 顺序播放
                return this.currentIndex < this.playlist.length - 1 ? this.currentIndex + 1 : -1;
        }
    }

    getPreviousSongIndex() {
        if (this.playlist.length === 0) return -1;

        switch (this.playMode) {
            case 'shuffle':
                // 随机播放时的上一首也是随机的
                if (this.playlist.length === 1) return 0;
                let randomIndex;
                do {
                    randomIndex = Math.floor(Math.random() * this.playlist.length);
                } while (randomIndex === this.currentIndex);
                return randomIndex;
            
            case 'reverse':
                // 倒序播放时的上一首是下一个
                return this.currentIndex < this.playlist.length - 1 ? this.currentIndex + 1 : 0;
            
            case 'sequence':
            case 'single':
            default:
                // 顺序播放
                return this.currentIndex > 0 ? this.currentIndex - 1 : this.playlist.length - 1;
        }
    }

    async nextSong() {
        if (this.playlist.length === 0) return;

        const nextIndex = this.getNextSongIndex();
        if (nextIndex !== -1) {
            await this.playSong(nextIndex);
        } else if (this.playMode === 'sequence' || this.playMode === 'reverse') {
            // 对于顺序播放和倒序播放，到达边界时循环播放
            if (this.playMode === 'sequence') {
                await this.playSong(0); // 从第一首开始
            } else {
                await this.playSong(this.playlist.length - 1); // 从最后一首开始
            }
        }
    }

    async handleSongEnded() {
        // 记录播放历史
        if (this.currentSong) {
            try {
                await electronAPI.database.addPlayHistory(this.currentSong.id);
            } catch (error) {
                console.error('添加播放历史失败:', error);
            }
        }

        switch (this.playMode) {
            case 'single':
                // 单曲循环
                this.audio.currentTime = 0;
                await this.audio.play();
                break;
            case 'sequence':
            case 'reverse':
            case 'shuffle':
            default:
                // 顺序播放、倒序播放、随机播放
                await this.nextSong();
                break;
        }
    }

    // 播放模式控制
    togglePlayMode() {
        const modes = ['sequence', 'reverse', 'shuffle', 'single'];
        const currentIndex = modes.indexOf(this.playMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.playMode = modes[nextIndex];
        
        this.updatePlayModeButtons();
        this.saveSettings();
        this.showMessage(this.getPlayModeText(), 'info');
    }

    setPlayMode(mode) {
        const validModes = ['sequence', 'reverse', 'shuffle', 'single'];
        if (validModes.includes(mode)) {
            this.playMode = mode;
            this.updatePlayModeButtons();
            this.saveSettings();
        }
    }

    getPlayModeText() {
        const texts = {
            'sequence': '顺序播放',
            'reverse': '倒序播放',
            'shuffle': '随机播放',
            'single': '单曲循环'
        };
        return texts[this.playMode] || '顺序播放';
    }

    // 兼容旧的方法
    toggleShuffle() {
        if (this.playMode === 'shuffle') {
            this.setPlayMode('sequence');
        } else {
            this.setPlayMode('shuffle');
        }
    }

    toggleRepeat() {
        if (this.playMode === 'repeat') {
            this.setPlayMode('sequence');
        } else {
            this.setPlayMode('repeat');
        }
    }

    // 音量控制
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(100, volume));
        if (this.audio) {
            this.audio.volume = this.volume / 100;
        }
        
        const volumeRange = document.getElementById('volume-range');
        if (volumeRange) {
            volumeRange.value = this.volume;
        }
        
        const volumeDisplay = document.getElementById('volume-display');
        if (volumeDisplay) {
            volumeDisplay.textContent = this.volume;
        }
        
        this.updateVolumeButton();
        this.saveSettings();
    }

    toggleMute() {
        if (this.volume > 0) {
            this.lastVolume = this.volume;
            this.setVolume(0);
        } else {
            this.setVolume(this.lastVolume || 50);
        }
    }

    // 应用音量补偿
    async applyVolumeCompensation() {
        if (!this.currentSong || !this.audio) return;

        try {
            // 检查是否启用音量自动平衡
            const volumeSyncEnabled = await electronAPI.database.getSetting('volume_sync_enabled', true);

            // 如果未启用音量自动平衡，使用正常音量
            if (!volumeSyncEnabled) {
                this.audio.volume = this.volume / 100;
                return;
            }

            // 检查歌曲是否有音量增益值
            if (this.currentSong.volume_gain !== null && this.currentSong.volume_gain !== undefined) {
                // 计算补偿后的音量
                const baseVolume = this.volume / 100;
                const gain = this.currentSong.volume_gain;
                const compensatedVolume = baseVolume * Math.pow(10, gain / 20);

                // 限制在 0-1 范围内
                this.audio.volume = Math.max(0, Math.min(1, compensatedVolume));
            } else {
                // 没有增益值，使用正常音量
                this.audio.volume = this.volume / 100;
            }
        } catch (error) {
            // 出错时使用默认音量
            this.audio.volume = this.volume / 100;
        }
    }

    // 同步歌曲音量
    async analyzeSongVolume(songId) {
        try {
            this.showMessage('正在同步音量...', 'info');

            const targetLufs = await electronAPI.database.getSetting('volume_target_lufs', -16);
            const result = await electronAPI.volume.analyzeSong(songId, targetLufs);

            if (result.success) {
                this.showMessage(`音量同步完成：${result.volumeGain > 0 ? '+' : ''}${result.volumeGain.toFixed(1)} dB`, 'success');
                // 智能刷新当前视图
                await this.refreshCurrentView();
            } else {
                this.showMessage(`音量同步失败：${result.error || '未知错误'}`, 'error');
            }
        } catch (error) {
            logger.error('同步音量失败:', error);
            this.showMessage('音量同步失败', 'error');
        }
    }

    // 刷新当前视图（智能刷新）
    async refreshCurrentView() {
        try {
            const currentViewTitle = document.getElementById('current-view-title');
            const titleText = currentViewTitle ? currentViewTitle.textContent : '';

            switch (this.currentView) {
                case 'all-songs':
                    await this.loadMusicLibrary();
                    break;
                case 'recent':
                    await this.loadRecentlyPlayed();
                    break;
                default:
                    // 检查是否是歌单视图
                    if (this.currentView.startsWith('playlist-') && this.currentPlaylistId) {
                        await this.switchToPlaylist(this.currentPlaylistId, this.currentPlaylistName || '歌单');
                    } else if (titleText === '搜索结果') {
                        // 如果在搜索视图，重新执行搜索
                        const searchInput = document.getElementById('search-input');
                        if (searchInput && searchInput.value) {
                            await this.handleSearch(searchInput.value);
                        } else {
                            // 搜索框为空，加载所有歌曲
                            await this.loadMusicLibrary();
                        }
                    } else {
                        // 默认回退到所有歌曲
                        await this.loadMusicLibrary();
                    }
                    break;
            }
        } catch (error) {
            logger.error('刷新当前视图失败:', error);
        }
    }

    // 进度条控制
    seekTo(event) {
        if (!this.audio || !this.audio.duration) return;

        const progressContainer = event.currentTarget;
        const rect = progressContainer.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        const targetTime = percent * this.audio.duration;
        
        this.audio.currentTime = targetTime;
    }

    // 界面更新
    updatePlayButton(state) {
        const playBtn = document.getElementById('play-btn');
        if (!playBtn) return;

        switch (state) {
            case 'playing':
                playBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>`;
                playBtn.title = '暂停';
                break;
            case 'paused':
                playBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>`;
                playBtn.title = '播放';
                break;
            case 'loading':
                playBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 4"/>
                </svg>`;
                playBtn.title = '加载中';
                break;
        }
    }

    updateProgress() {
        if (!this.audio || !this.audio.duration) return;

        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        const progressFilled = document.getElementById('progress-filled');
        const progressHandle = document.getElementById('progress-handle');
        
        if (progressFilled) {
            progressFilled.style.width = percent + '%';
        }
        
        if (progressHandle) {
            progressHandle.style.left = percent + '%';
        }
    }

    updateTimeDisplay() {
        const currentTime = document.getElementById('current-time');
        const totalTime = document.getElementById('total-time');
        
        if (currentTime && this.audio) {
            currentTime.textContent = utils.formatTime(this.audio.currentTime);
        }
        
        if (totalTime && this.audio) {
            totalTime.textContent = utils.formatTime(this.audio.duration);
        }
    }

    updateCurrentSongInfo() {
        const titleElement = document.getElementById('current-title');
        const artistElement = document.getElementById('current-artist');
        const coverElement = document.getElementById('current-cover');
        
        if (this.currentSong) {
            if (titleElement) {
                titleElement.textContent = this.currentSong.title;
                // 检查标题长度，如果过长则添加滚动效果
                this.checkTitleScrolling(titleElement, this.currentSong.title);
            }
            if (artistElement) {
                artistElement.textContent = this.currentSong.artist || '未知艺术家';
            }
            if (coverElement) {
                this.updateAlbumCover(coverElement, this.currentSong);
            }
        } else {
            if (titleElement) {
                titleElement.textContent = '未选择歌曲';
                titleElement.classList.remove('scrolling');
            }
            if (artistElement) {
                artistElement.textContent = '--';
            }
            if (coverElement) {
                this.resetAlbumCover(coverElement);
            }
        }
    }

    // 更新专辑封面
    updateAlbumCover(coverElement, song) {
        // 显示加载状态
        coverElement.style.opacity = '0.5';
        
        // 如果有缩略图URL，尝试加载
        if (song.thumbnail) {
            // 添加加载错误处理
            const img = new Image();
            img.onload = () => {
                coverElement.src = song.thumbnail;
                coverElement.style.display = 'block';
                coverElement.style.opacity = '1';
                // 移除错误状态
                coverElement.classList.remove('cover-error');
            };
            img.onerror = () => {
                console.warn('专辑封面加载失败:', song.thumbnail);
                this.setDefaultAlbumCover(coverElement);
                // 添加错误状态样式
                coverElement.classList.add('cover-error');
                // 如果有多个缩略图源，可以尝试备用URL
                this.tryAlternativeThumbnail(coverElement, song);
            };
            
            // 设置加载超时
            setTimeout(() => {
                if (coverElement.style.opacity === '0.5') {
                    console.warn('专辑封面加载超时:', song.thumbnail);
                    this.setDefaultAlbumCover(coverElement);
                    coverElement.classList.add('cover-error');
                }
            }, 5000);
            
            img.src = song.thumbnail;
        } else {
            // 没有缩略图，显示默认图标
            this.setDefaultAlbumCover(coverElement);
        }
    }

    // 尝试备用缩略图源
    tryAlternativeThumbnail(coverElement, song) {
        // 这里可以实现备用缩略图逻辑
        // 例如从其他API获取艺术家头像等
        console.log('尝试获取备用缩略图源...');
        
        // 目前先显示默认图标
        this.setDefaultAlbumCover(coverElement);
    }

    // 设置默认专辑封面
    setDefaultAlbumCover(coverElement) {
        coverElement.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 24 24' fill='%23ccc'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5c-1.25 0-2.5-0.5-2.5-2.5s1.25-2.5 2.5-2.5 2.5 0.5 2.5 2.5-1.25 2.5-2.5 2.5zm4-6c-1.25 0-2.5-0.5-2.5-2.5S12.75 5.5 14 5.5s2.5 0.5 2.5 2.5S15.25 10.5 14 10.5z'/%3E%3C/svg%3E";
        coverElement.style.display = 'block';
        coverElement.style.opacity = '1';
    }

    // 重置专辑封面到默认状态
    resetAlbumCover(coverElement) {
        this.setDefaultAlbumCover(coverElement);
    }

    checkTitleScrolling(titleElement, title) {
        // 创建临时元素来测量文本宽度
        const tempElement = document.createElement('div');
        tempElement.style.visibility = 'hidden';
        tempElement.style.position = 'absolute';
        tempElement.style.fontSize = '14px';
        tempElement.style.fontWeight = '500';
        tempElement.style.whiteSpace = 'nowrap';
        tempElement.textContent = title;
        document.body.appendChild(tempElement);
        
        const textWidth = tempElement.offsetWidth;
        document.body.removeChild(tempElement);
        
        // 如果文本宽度超过容器宽度（约180px），则启用滚动
        if (textWidth > 180) {
            titleElement.classList.add('scrolling');
        } else {
            titleElement.classList.remove('scrolling');
        }
    }

    updateCurrentSongHighlight() {
        // 移除所有高亮
        const songItems = document.querySelectorAll('.song-item');
        songItems.forEach(item => {
            dom.removeClass(item, 'playing');
        });

        // 高亮当前歌曲
        if (this.currentSong) {
            const currentItem = document.querySelector(`[data-song-id="${this.currentSong.id}"]`);
            if (currentItem) {
                dom.addClass(currentItem, 'playing');
            }
        }
    }

    // 更新播放模式按钮
    updatePlayModeButtons() {
        this.updateShuffleButton();
        this.updateRepeatButton();
    }

    updateShuffleButton() {
        const shuffleBtn = document.getElementById('shuffle-btn');
        if (shuffleBtn) {
            if (this.playMode === 'shuffle') {
                shuffleBtn.style.color = '#667eea';
                shuffleBtn.classList.add('active');
                shuffleBtn.title = '随机播放';
            } else {
                shuffleBtn.style.color = '#666';
                shuffleBtn.classList.remove('active');
                shuffleBtn.title = '随机播放';
            }
        }
    }

    updateRepeatButton() {
        const repeatBtn = document.getElementById('repeat-btn');
        if (repeatBtn) {
            // 移除active类
            repeatBtn.classList.remove('active');
            
            // 根据播放模式设置不同的图标和颜色
            switch (this.playMode) {
                case 'single':
                    repeatBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="17,1 21,5 17,9"/>
                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7,23 3,19 7,15"/>
                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                        <text x="12" y="16" text-anchor="middle" font-size="10" fill="currentColor">1</text>
                    </svg>`;
                    repeatBtn.style.color = '#667eea';
                    repeatBtn.classList.add('active');
                    repeatBtn.title = '单曲循环';
                    break;
                case 'reverse':
                    repeatBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="19,12 5,12"/>
                        <polyline points="9,16 5,12 9,8"/>
                    </svg>`;
                    repeatBtn.style.color = '#667eea';
                    repeatBtn.classList.add('active');
                    repeatBtn.title = '倒序播放';
                    break;
                case 'sequence':
                default:
                    repeatBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="17,1 21,5 17,9"/>
                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7,23 3,19 7,15"/>
                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                    </svg>`;
                    repeatBtn.style.color = '#666';
                    repeatBtn.title = '顺序播放';
                    break;
            }
        }
    }

    updateVolumeButton() {
        const volumeBtn = document.getElementById('volume-btn');
        if (volumeBtn) {
            if (this.volume === 0) {
                volumeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <line x1="23" y1="9" x2="17" y2="15"/>
                    <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>`;
            } else if (this.volume < 50) {
                volumeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>`;
            } else {
                volumeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>`;
            }
        }
    }

    // 音乐库管理
    async loadMusicLibrary() {
        try {
            const songs = await electronAPI.database.getSongs();
            this.playlist = songs;
            this.renderSongsList();
            this.updateCurrentViewCount();
            
            // 显示空状态或歌曲列表
            const emptyState = document.getElementById('empty-state');
            const songsContainer = document.querySelector('.songs-container');
            
            if (songs.length === 0) {
                if (emptyState) emptyState.style.display = 'flex';
                if (songsContainer) songsContainer.style.display = 'none';
            } else {
                if (emptyState) emptyState.style.display = 'none';
                if (songsContainer) songsContainer.style.display = 'block';
            }
            
        } catch (error) {
            logger.error('加载音乐库失败:', error);
            this.showMessage('加载音乐库失败', 'error');
        }
    }

    renderSongsList() {
        const songsList = document.getElementById('songs-list');
        if (!songsList) return;

        songsList.innerHTML = '';

        this.playlist.forEach((song, index) => {
            const songItem = this.createSongItem(song, index);
            songsList.appendChild(songItem);
        });

        // 更新计数
        const countElement = document.getElementById('current-view-count');
        if (countElement) {
            countElement.textContent = `${this.playlist.length} 首歌曲`;
        }
    }

    createSongItem(song, index) {
        const item = dom.createElement('div', {
            className: 'song-item',
            attributes: {
                'data-song-id': song.id,
                'data-id': song.id,
                'data-index': index
            }
        });

        item.innerHTML = `
            <div class="song-index">${index + 1}</div>
            <div class="song-title">${song.title}</div>
            <div class="song-artist">${song.artist || '未知艺术家'}</div>
            <div class="song-duration">${utils.formatTime(song.duration)}</div>
        `;

        // 双击播放
        item.addEventListener('dblclick', () => {
            this.playSong(index);
        });

        // 右键菜单
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, item);
        });

        return item;
    }

    // 更新当前视图的歌曲数量显示
    updateCurrentViewCount() {
        const countElement = document.getElementById('current-view-count');
        if (countElement) {
            countElement.textContent = `${this.playlist.length} 首歌曲`;
        }
    }

    // 歌单管理
    async loadPlaylistsToSidebar() {
        try {
            const playlists = await electronAPI.database.getAllPlaylists();
            const playlistsContainer = document.querySelector('.playlists-container');
            
            if (!playlistsContainer) return;
            
            // 清空现有列表
            playlistsContainer.innerHTML = '';
            
            // 添加歌单项
            playlists.forEach(playlist => {
                const playlistItem = document.createElement('div');
                playlistItem.className = 'nav-item playlist-item';
                playlistItem.dataset.playlistId = playlist.id;
                playlistItem.innerHTML = `
                    <span class="nav-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="3" rx="1"/>
                            <rect x="3" y="10" width="18" height="3" rx="1"/>
                            <rect x="3" y="16" width="10" height="3" rx="1"/>
                            <circle cx="18" cy="17.5" r="2.5" fill="currentColor"/>
                            <path d="M16 15v5" stroke-width="1.5"/>
                        </svg>
                    </span>
                    <span class="nav-text">${playlist.name}</span>
                    <span class="playlist-count">${playlist.song_count || 0}</span>
                `;
                
                playlistsContainer.appendChild(playlistItem);
                
                // 绑定点击事件
                playlistItem.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchToPlaylist(playlist.id, playlist.name);
                });
                
                // 绑定右键菜单
                playlistItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showPlaylistContextMenu(e, playlist);
                });
            });
            
        } catch (error) {
            logger.error('加载歌单列表失败:', error);
        }
    }

    async switchToPlaylist(playlistId, playlistName) {
        try {
            this.currentView = `playlist-${playlistId}`;
            this.currentPlaylistId = playlistId;
            this.currentPlaylistName = playlistName;

            // 更新导航高亮
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.classList.remove('active');
            });

            const currentItem = document.querySelector(`[data-playlist-id="${playlistId}"]`);
            if (currentItem) {
                currentItem.classList.add('active');
            }

            // 加载歌单歌曲
            const songs = await electronAPI.database.getPlaylistSongs(playlistId);
            this.playlist = songs;

            // 更新界面
            document.getElementById('current-view-title').textContent = playlistName;
            document.getElementById('current-view-count').textContent = `${songs.length} 首歌曲`;

            this.renderSongsList();
            
        } catch (error) {
            logger.error('切换到歌单失败:', error);
            this.showMessage('加载歌单失败', 'error');
        }
    }

    showPlaylistContextMenu(event, playlist) {
        // 移除现有的右键菜单
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // 创建歌单右键菜单
        const contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu playlist-context-menu';
        contextMenu.innerHTML = `
            <ul class="context-menu-list">
                <li><a href="#" data-action="rename">重命名</a></li>
                <li class="separator"></li>
                <li><a href="#" data-action="delete" class="danger">删除歌单</a></li>
            </ul>
        `;
        
        // 定位菜单
        contextMenu.style.left = event.pageX + 'px';
        contextMenu.style.top = event.pageY + 'px';
        
        // 添加到页面
        document.body.appendChild(contextMenu);
        
        // 绑定点击事件
        const actions = contextMenu.querySelectorAll('[data-action]');
        actions.forEach(action => {
            action.addEventListener('click', (e) => {
                e.preventDefault();
                this.handlePlaylistContextAction(action.dataset.action, playlist);
                document.body.removeChild(contextMenu);
            });
        });
        
        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                if (contextMenu.parentNode === document.body) {
                    document.body.removeChild(contextMenu);
                }
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    async handlePlaylistContextAction(action, playlist) {
        switch (action) {
            case 'rename':
                await this.renamePlaylist(playlist);
                break;
            case 'delete':
                await this.deletePlaylist(playlist);
                break;
        }
    }

    async renamePlaylist(playlist) {
        // 创建重命名对话框
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>重命名歌单</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="rename-playlist-name">歌单名称:</label>
                        <input type="text" id="rename-playlist-name" value="${playlist.name}" placeholder="请输入新的歌单名称">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
                    <button class="btn btn-primary" id="save-playlist-name-btn">保存</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 聚焦到输入框并选中文本
        const nameInput = dialog.querySelector('#rename-playlist-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
        
        // 保存按钮事件
        const saveBtn = dialog.querySelector('#save-playlist-name-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (!nameInput) {
                    this.showMessage('输入框不存在', 'error');
                    return;
                }
                
                const newName = nameInput.value.trim();
                
                if (!newName) {
                    this.showMessage('请输入歌单名称', 'error');
                    return;
                }
                
                if (newName === playlist.name) {
                dialog.remove();
                return;
            }
            
            try {
                const success = await electronAPI.database.updatePlaylist(playlist.id, { name: newName });
                if (success) {
                    this.showMessage('歌单重命名成功', 'success');
                    await this.loadPlaylistsToSidebar();
                    
                    // 如果当前正在查看这个歌单，更新标题
                    if (this.currentView === `playlist-${playlist.id}`) {
                        document.getElementById('current-view-title').textContent = newName;
                    }
                    
                    dialog.remove();
                } else {
                    this.showMessage('重命名失败', 'error');
                }
            } catch (error) {
                logger.error('重命名歌单失败:', error);
                this.showMessage('重命名失败: ' + error.message, 'error');
            }
            });
        }
        
        // 按 Enter 键保存
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (saveBtn) {
                    saveBtn.click();
                }
            } else if (e.key === 'Escape') {
                dialog.remove();
            }
        });
    }

    async exportPlaylist(playlist) {
        // TODO: 实现歌单导出功能
        this.showMessage('歌单导出功能即将推出', 'info');
    }

    async deletePlaylist(playlist) {
        if (confirm(`确定要删除歌单"${playlist.name}"吗？这将不会删除歌曲文件。删除之后请手动切屏一次，否则无法正常显示`)) {
            try {
                await electronAPI.database.removePlaylist(playlist.id);
                this.showMessage('歌单删除成功', 'success');
                await this.loadPlaylistsToSidebar();
                
                // 如果当前正在查看被删除的歌单，切换到所有歌曲
                if (this.currentView === `playlist-${playlist.id}`) {
                    this.switchView('all-songs');
                }
            } catch (error) {
                logger.error('删除歌单失败:', error);
                this.showMessage('删除失败', 'error');
            }
        }
    }

    // 搜索功能
    async handleSearch(query) {
        if (!query.trim()) {
            await this.loadMusicLibrary();
            return;
        }

        try {
            // 只搜索歌曲标题和艺术家
            const results = await electronAPI.database.searchSongs(query);
            this.playlist = results;
            this.renderSongsList();
            
            // 更新视图标题
            const currentViewTitle = document.getElementById('current-view-title');
            const currentViewCount = document.getElementById('current-view-count');
            if (currentViewTitle) currentViewTitle.textContent = '搜索结果';
            if (currentViewCount) currentViewCount.textContent = `${results.length} 首歌曲`;
            
        } catch (error) {
            logger.error('搜索失败:', error);
            this.showMessage('搜索失败', 'error');
        }
    }

    // 视图切换
    async switchView(view) {
        this.currentView = view;
        
        // 更新导航高亮
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            // 检查data-view属性
            if (item.dataset.view === view) {
                item.classList.add('active');
            }
        });

        // 加载对应视图的数据
        try {
            switch (view) {
                case 'all-songs':
                    await this.loadMusicLibrary();
                    document.getElementById('current-view-title').textContent = '所有歌曲';
                    break;
                case 'recent':
                    await this.loadRecentlyPlayed();
                    document.getElementById('current-view-title').textContent = '最近播放';
                    break;
            }
        } catch (error) {
            logger.error('切换视图失败:', error);
        }
    }

    async loadRecentlyPlayed() {
        try {
            const songs = await electronAPI.database.getRecentlyPlayed(50);
            this.playlist = songs;
            
            // 更新界面
            document.getElementById('current-view-count').textContent = `${songs.length} 首歌曲`;
            this.renderSongsList();
            
            // 显示空状态（如果没有播放历史）
            const emptyState = document.getElementById('empty-state');
            const songsContainer = document.querySelector('.songs-container');
            
            if (songs.length === 0) {
                if (emptyState) {
                    emptyState.style.display = 'flex';
                    emptyState.innerHTML = `
                        <div class="empty-icon">🕒</div>
                        <h3>还没有播放历史</h3>
                        <p>开始播放歌曲后，这里会显示您最近播放的歌曲</p>
                    `;
                }
                if (songsContainer) songsContainer.style.display = 'none';
            } else {
                if (emptyState) emptyState.style.display = 'none';
                if (songsContainer) songsContainer.style.display = 'block';
            }
            
        } catch (error) {
            logger.error('加载最近播放失败:', error);
            this.showMessage('加载最近播放失败', 'error');
        }
    }

    // 文件操作
    async selectLocalFiles() {
        try {
            const songs = await electronAPI.file.selectMusic();
            if (songs.length > 0) {
                this.showMessage(`成功添加 ${songs.length} 首歌曲`, 'success');
                // 使用 refreshCurrentView() 保持当前视图
                await this.refreshCurrentView();
            }
        } catch (error) {
            logger.error('添加本地音乐失败:', error);
            this.showMessage('添加本地音乐失败', 'error');
        }
    }

    // 下载功能
    showDownloadDialog() {
        const dialog = document.getElementById('download-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const urlInput = document.getElementById('download-url');
            if (urlInput) {
                urlInput.focus();
            }
        }
    }

    hideDownloadDialog() {
        const dialog = document.getElementById('download-dialog');
        if (dialog) {
            dialog.style.display = 'none';
            this.clearDownloadForm();
        }
    }

    clearDownloadForm() {
        const urlInput = document.getElementById('download-url');
        const preview = document.getElementById('video-preview');
        const progress = document.getElementById('download-progress');
        
        if (urlInput) urlInput.value = '';
        if (preview) preview.style.display = 'none';
        if (progress) progress.style.display = 'none';
    }

    async previewVideo(url) {
        try {
            const videoInfo = await electronAPI.download.getVideoInfo(url);
            const preview = document.getElementById('video-preview');
            
            if (preview) {
                preview.style.display = 'flex';
                
                const thumbnail = document.getElementById('video-thumbnail');
                const title = document.getElementById('video-title');
                const uploader = document.getElementById('video-uploader');
                const duration = document.getElementById('video-duration');
                
                if (thumbnail) thumbnail.src = videoInfo.thumbnail;
                if (title) title.textContent = videoInfo.title;
                if (uploader) uploader.textContent = '上传者: ' + videoInfo.uploader;
                if (duration) duration.textContent = '时长: ' + utils.formatTime(videoInfo.duration);
            }
        } catch (error) {
            logger.error('获取视频信息失败:', error);
            this.showMessage('获取视频信息失败', 'error');
        }
    }

    async startDownload() {
        const urlInput = document.getElementById('download-url');

        if (!urlInput || !urlInput.value.trim()) {
            this.showMessage('请输入视频链接', 'warning');
            return;
        }

        const inputText = urlInput.value.trim();
        // 智能提取B站链接
        const url = utils.extractBilibiliUrl(inputText);

        if (!url) {
            this.showMessage('未找到有效的链接', 'warning');
            return;
        }

        try {
            this.showDownloadProgress();

            const result = await electronAPI.download.bilibiliVideo(url, {
                downloadLyrics: true  // 默认下载歌词
            });

            if (result.success) {
                this.showMessage('下载完成', 'success');
                this.hideDownloadDialog();
                await this.refreshCurrentView();
            }
        } catch (error) {
            logger.error('下载失败:', error);

            // 简化错误消息
            let message = error.message;
            if (error.message.includes('歌曲已存在于音乐库')) {
                message = '歌曲已存在于音乐库';
            }

            this.showMessage(message, 'error');
        } finally {
            this.hideDownloadProgress();
        }
    }

    showDownloadProgress() {
        const progress = document.getElementById('download-progress');
        const startBtn = document.getElementById('download-start-btn');
        const status = document.getElementById('download-status');

        if (progress) progress.style.display = 'block';
        if (startBtn) startBtn.disabled = true;

        // 重置进度显示
        if (status) status.textContent = '准备下载...';

        // 隐藏分数徽章
        const stageBadge = document.getElementById('download-stage');
        if (stageBadge) stageBadge.style.display = 'none';

        // 监听下载进度
        this.downloadProgressUnsubscribe = electronAPI.download.onProgress((data) => {
            this.updateDownloadProgress(data);
        });

        // 监听阶段进度
        this.stageProgressUnsubscribe = electronAPI.download.onStageProgress((data) => {
            this.updateStageProgress(data);
        });
    }

    hideDownloadProgress() {
        const progress = document.getElementById('download-progress');
        const startBtn = document.getElementById('download-start-btn');
        const stageBadge = document.getElementById('download-stage');

        if (progress) progress.style.display = 'none';
        if (startBtn) startBtn.disabled = false;
        if (stageBadge) stageBadge.style.display = 'none';

        if (this.downloadProgressUnsubscribe) {
            this.downloadProgressUnsubscribe();
            this.downloadProgressUnsubscribe = null;
        }

        if (this.stageProgressUnsubscribe) {
            this.stageProgressUnsubscribe();
            this.stageProgressUnsubscribe = null;
        }

        this.currentDownloadStage = null;
        this.totalDownloadStages = 0;
    }

    updateDownloadProgress(data) {
        const status = document.getElementById('download-status');
        const stageBadge = document.getElementById('download-stage');

        // 如果有阶段信息，显示分数徽章
        if (this.currentDownloadStage && this.totalDownloadStages) {
            if (stageBadge) {
                stageBadge.textContent = `${this.currentDownloadStage}/${this.totalDownloadStages}`;
                stageBadge.style.display = 'inline-flex';
            }
        }

        if (data.type === 'stdout') {
            const output = data.data;

            // 解析 yt-dlp 的进度输出
            const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
            if (progressMatch) {
                if (status) {
                    status.textContent = `正在下载视频文件...`;
                }
            }

            // 检查是否包含其他状态信息
            if (output.includes('[download] Destination:')) {
                if (status) status.textContent = `准备下载...`;
            } else if (output.includes('[ffmpeg]') || output.includes('Post-process')) {
                if (status) status.textContent = `正在转换为 MP3 格式...`;
            } else if (output.includes('Deleting original file')) {
                if (status) status.textContent = `正在清理临时文件...`;
            }
        }
    }

    updateStageProgress(data) {
        // 保存阶段信息
        this.currentDownloadStage = data.stage;
        this.totalDownloadStages = data.totalStages;

        const status = document.getElementById('download-status');
        const stageBadge = document.getElementById('download-stage');

        if (status) {
            status.textContent = `${data.description}`;
        }

        // 更新分数徽章
        if (stageBadge) {
            stageBadge.textContent = `${data.stage}/${data.totalStages}`;
            stageBadge.style.display = 'inline-flex';
        }
    }

    // 歌单功能
    showCreatePlaylistDialog() {
        const dialog = document.getElementById('playlist-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const nameInput = document.getElementById('playlist-name');
            if (nameInput) {
                nameInput.focus();
            }
        }
    }

    hidePlaylistDialog() {
        const dialog = document.getElementById('playlist-dialog');
        if (dialog) {
            dialog.style.display = 'none';
            const nameInput = document.getElementById('playlist-name');
            if (nameInput) {
                nameInput.value = '';
            }
        }
    }

    async createPlaylist() {
        const nameInput = document.getElementById('playlist-name');
        if (!nameInput || !nameInput.value.trim()) {
            this.showMessage('请输入歌单名称', 'warning');
            return;
        }

        try {
            const playlistName = nameInput.value.trim();
            await electronAPI.database.createPlaylist(playlistName);
            
            this.showMessage('歌单创建成功', 'success');
            this.hidePlaylistDialog();
            nameInput.value = '';
            
            // 刷新歌单列表
            await this.loadPlaylistsToSidebar();
        } catch (error) {
            logger.error('创建歌单失败:', error);
            this.showMessage('创建歌单失败', 'error');
        }
    }

    // 歌词功能
    async loadLyrics(songTitle) {
        try {
            this.currentLyrics = await electronAPI.lyrics.get(songTitle);
        } catch (error) {
            logger.error('加载歌词失败:', error);
            this.currentLyrics = null;
        }
    }

    startLyricsSync() {
        if (this.lyricsInterval) {
            clearInterval(this.lyricsInterval);
        }
        
        this.lyricsInterval = setInterval(() => {
            this.updateLyrics();
        }, 100);
    }

    stopLyricsSync() {
        if (this.lyricsInterval) {
            clearInterval(this.lyricsInterval);
            this.lyricsInterval = null;
        }
    }

    updateLyrics() {
        if (!this.currentLyrics || !this.audio) return;
        
        const currentTime = this.audio.currentTime;
        let currentLyric = null;
        
        for (let i = 0; i < this.currentLyrics.length; i++) {
            if (this.currentLyrics[i].time <= currentTime) {
                currentLyric = this.currentLyrics[i];
            } else {
                break;
            }
        }
        
        if (currentLyric) {
            electronAPI.lyrics.updateWindow(currentLyric.text);
        }
    }

    toggleLyricsWindow() {
        electronAPI.lyrics.toggleWindow();
    }

    // 智能定位右键菜单（防止超出窗口）
    positionContextMenu(menu, x, y) {
        // 先添加到 DOM 以获取实际尺寸
        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // 调整位置
        let finalX = x;
        let finalY = y;

        // 检查右边界
        if (x + menuRect.width > windowWidth) {
            finalX = windowWidth - menuRect.width - 8;
        }

        // 检查下边界
        if (y + menuRect.height > windowHeight) {
            finalY = windowHeight - menuRect.height - 8;
        }

        // 检查左边界
        if (finalX < 8) {
            finalX = 8;
        }

        // 检查上边界
        if (finalY < 8) {
            finalY = 8;
        }

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    }

    // 右键菜单
    showContextMenu(event, songItem) {
        event.preventDefault();

        const songId = parseInt(songItem.dataset.id);
        const song = this.playlist.find(s => s.id === songId);

        if (!song) return;

        // 移除现有的右键菜单
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // 创建右键菜单
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="menu-item" data-action="play">播放</div>
            <div class="menu-item" data-action="add-to-playlist">添加到歌单</div>
            ${this.currentView.startsWith('playlist-') ? '<div class="menu-item" data-action="remove-from-playlist">从歌单移除</div>' : ''}
            <div class="menu-item" data-action="edit-info">修改信息</div>
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="show-in-explorer">在文件夹中显示</div>
            <div class="menu-item" data-action="info">歌曲信息</div>
            <div class="menu-item" data-action="analyze-volume">同步音量</div>
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="delete">删除</div>
        `;

        // 智能定位菜单
        this.positionContextMenu(menu, event.pageX, event.pageY);
        
        // 设置当前选中的歌曲
        this.contextMenuSong = song;
        
        // 点击菜单项
        menu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action) {
                this.handleContextMenuAction(action);
            }
            menu.remove();
        });
        
        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    async handleContextMenuAction(action) {
        if (!this.contextMenuSong) return;
        
        const song = this.contextMenuSong;

        switch (action) {
            case 'play':
                const index = this.playlist.findIndex(s => s.id === song.id);
                if (index !== -1) {
                    await this.playSong(index);
                }
                break;
            case 'add-to-playlist':
                await this.showAddToPlaylistDialog(song.id);
                break;
            case 'remove-from-playlist':
                await this.removeFromCurrentPlaylist(song.id);
                break;
            case 'edit-info':
                await this.showEditSongInfoDialog(song);
                break;
            case 'show-in-explorer':
                await electronAPI.file.showInExplorer(song.path);
                break;
            case 'info':
                this.showSongInfo(song);
                break;
            case 'analyze-volume':
                await this.analyzeSongVolume(song.id);
                break;
            case 'delete':
                await this.deleteSong(song.id);
                break;
        }
        
        this.contextMenuSong = null;
    }

    async removeFromCurrentPlaylist(songId) {
        if (!this.currentView.startsWith('playlist-')) return;
        
        const playlistId = parseInt(this.currentView.split('-')[1]);
        
        if (confirm('确定要从当前歌单中移除这首歌曲吗？移除后请手动切屏一次，否则无法正常显示')) {
            try {
                await electronAPI.database.removeFromPlaylist(playlistId, songId);
                this.showMessage('歌曲已从歌单中移除', 'success');
                
                // 重新加载当前歌单
                await this.switchToPlaylist(playlistId);
            } catch (error) {
                logger.error('从歌单移除歌曲失败:', error);
                this.showMessage('移除失败', 'error');
            }
        }
    }

    async showAddToPlaylistDialog(songId) {
        try {
            // 获取所有歌单
            const allPlaylists = await electronAPI.database.getAllPlaylists();
            // 获取歌曲已在的歌单
            const songPlaylists = await electronAPI.database.getSongPlaylists(songId);
            const songPlaylistIds = songPlaylists.map(p => p.id);
            
            // 创建对话框
            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>添加到歌单</h3>
                        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="playlist-selection">
                            <div class="create-new-playlist">
                                <input type="text" id="new-playlist-name" placeholder="创建新歌单..." />
                                <button id="create-new-playlist-btn">创建</button>
                            </div>
                            <div class="playlist-list">
                                ${allPlaylists.map(playlist => `
                                    <label class="playlist-item ${songPlaylistIds.includes(playlist.id) ? 'disabled' : ''}">
                                        <input type="checkbox" value="${playlist.id}" ${songPlaylistIds.includes(playlist.id) ? 'checked disabled' : ''} />
                                        <span>${playlist.name}</span>
                                        <small>${songPlaylistIds.includes(playlist.id) ? '已在歌单中' : ''}</small>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
                        <button class="btn btn-primary" id="add-to-playlists-btn">添加</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(dialog);
            
            // 创建新歌单
            const createBtn = dialog.querySelector('#create-new-playlist-btn');
            createBtn.addEventListener('click', async () => {
                const nameInput = dialog.querySelector('#new-playlist-name');
                const name = nameInput.value.trim();
                
                if (!name) {
                    this.showMessage('请输入歌单名称', 'error');
                    return;
                }
                
                try {
                    const newPlaylist = await electronAPI.database.createPlaylist(name);
                    await electronAPI.database.addToPlaylist(newPlaylist.id, songId);
                    
                    this.showMessage('已创建新歌单并添加歌曲', 'success');
                    await this.loadPlaylistsToSidebar();
                    
                    dialog.remove();
                } catch (error) {
                    logger.error('创建歌单失败:', error);
                    this.showMessage('创建歌单失败', 'error');
                }
            });
            
            // 添加到选中的歌单
            const addBtn = dialog.querySelector('#add-to-playlists-btn');
            addBtn.addEventListener('click', async () => {
                const checkboxes = dialog.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
                const playlistIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
                
                if (playlistIds.length === 0) {
                    this.showMessage('请选择要添加的歌单', 'error');
                    return;
                }
                
                try {
                    for (const playlistId of playlistIds) {
                        await electronAPI.database.addToPlaylist(playlistId, songId);
                    }
                    
                    this.showMessage(`已添加到 ${playlistIds.length} 个歌单`, 'success');
                    dialog.remove();
                } catch (error) {
                    logger.error('添加到歌单失败:', error);
                    this.showMessage('添加到歌单失败', 'error');
                }
            });
            
        } catch (error) {
            logger.error('显示添加到歌单对话框失败:', error);
            this.showMessage('操作失败', 'error');
        }
    }

    // 其他功能
    shuffleAll() {
        if (this.playlist.length === 0) return;
        
        this.playMode = 'shuffle';
        this.updateShuffleButton();
        this.playSong(Math.floor(Math.random() * this.playlist.length));
    }

    async showEditSongInfoDialog(song) {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>修改歌曲信息</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="edit-song-form">
                        <div class="form-group">
                            <label for="edit-song-title">标题:</label>
                            <input type="text" id="edit-song-title" value="${song.title || ''}" placeholder="请输入歌曲标题">
                        </div>
                        <div class="form-group">
                            <label for="edit-song-artist">艺术家:</label>
                            <input type="text" id="edit-song-artist" value="${song.artist || ''}" placeholder="请输入艺术家名称">
                        </div>
                        <div class="form-info">
                            <p><strong>文件路径:</strong> ${song.path}</p>
                            <p><strong>时长:</strong> ${utils.formatTime(song.duration || 0)}</p>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
                    <button class="btn btn-primary" id="save-song-info-btn">保存</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 聚焦到第一个输入框
        const titleInput = dialog.querySelector('#edit-song-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
        
        // 保存按钮事件
        const saveBtn = dialog.querySelector('#save-song-info-btn');
        saveBtn.addEventListener('click', async () => {
            const title = dialog.querySelector('#edit-song-title').value.trim();
            const artist = dialog.querySelector('#edit-song-artist').value.trim();
            
            if (!title) {
                this.showMessage('请输入歌曲标题', 'error');
                return;
            }
            
            try {
                // 更新数据库
                await electronAPI.database.updateSong(song.id, {
                    title: title,
                    artist: artist
                });
                
                // 更新本地数据
                const songIndex = this.playlist.findIndex(s => s.id === song.id);
                if (songIndex !== -1) {
                    this.playlist[songIndex].title = title;
                    this.playlist[songIndex].artist = artist;
                }
                
                // 重新渲染歌曲列表
                this.renderSongsList();
                
                // 如果当前播放的是这首歌，更新播放器显示
                if (this.currentSong && this.currentSong.id === song.id) {
                    this.currentSong.title = title;
                    this.currentSong.artist = artist;
                    this.updateCurrentSongInfo(); // 更新当前歌曲信息显示
                }
                
                this.showMessage('歌曲信息已更新', 'success');
                dialog.remove();
                
            } catch (error) {
                logger.error('更新歌曲信息失败:', error);
                this.showMessage('更新失败', 'error');
            }
        });
        
        // 按 Enter 键保存
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveBtn.click();
            } else if (e.key === 'Escape') {
                dialog.remove();
            }
        });
    }

    showSongInfo(song) {
        const hasVolumeGain = song.volume_gain !== null && song.volume_gain !== undefined;

        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>歌曲信息</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="song-info">
                        <div class="info-item">
                            <label>标题</label>
                            <span>${song.title}</span>
                        </div>
                        <div class="info-item">
                            <label>艺术家</label>
                            <span>${song.artist || '未知'}</span>
                        </div>
                        <div class="info-item">
                            <label>时长</label>
                            <span>${utils.formatTime(song.duration || 0)}</span>
                        </div>
                        <div class="info-item">
                            <label>播放次数</label>
                            <span>${song.play_count || 0}</span>
                        </div>
                        <div class="info-item">
                            <label>文件路径</label>
                            <span>${song.path}</span>
                        </div>
                        <div class="info-item">
                            <label>添加时间</label>
                            <span>${new Date(song.added_at).toLocaleString()}</span>
                        </div>
                    </div>

                    ${hasVolumeGain ? `
                    <div class="info-section">
                        <div class="info-section-title">
                            音量同步
                            <span class="status-indicator status-success" style="margin-left: auto;"></span>
                            <span class="status-text status-success">已同步</span>
                        </div>
                        <div class="volume-details">
                            <div class="volume-info-row">
                                <span class="volume-label">原始响度</span>
                                <span class="volume-value">${song.integrated_loudness ? parseFloat(song.integrated_loudness).toFixed(1) : '未知'} LUFS</span>
                            </div>
                            <div class="volume-info-row">
                                <span class="volume-label">同步后响度</span>
                                <span class="volume-value">${song.integrated_loudness ? (song.integrated_loudness + song.volume_gain).toFixed(1) : '未知'} LUFS</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div class="info-section">
                        <div class="info-section-title">
                            音量同步
                            <span class="status-indicator status-warning" style="margin-left: auto;"></span>
                            <span class="status-text status-warning">未同步</span>
                        </div>
                        <div class="volume-details">
                            <div class="volume-info-row">
                                <span class="volume-label">原始响度</span>
                                <span class="volume-value">未知</span>
                            </div>
                        </div>
                    </div>
                    `}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
    }

    // 显示设置对话框
    async showSettingsDialog() {
        try {
            // 获取当前设置
            const targetLufs = await electronAPI.database.getSetting('volume_target_lufs', -16);
            const volumeSyncEnabled = await electronAPI.database.getSetting('volume_sync_enabled', true);
            const volumeStats = await electronAPI.volume.getStats();

            // 获取版本号
            let versionText = 'v1.0.0';
            try {
                const versionInfo = await electronAPI.app.getVersion();
                if (versionInfo.success) {
                    versionText = `v${versionInfo.version}`;
                }
            } catch (error) {
                console.error('获取版本号失败:', error);
            }

            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <div class="modal-header">
                        <h3>设置</h3>
                        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                    </div>
                    <div class="modal-body" style="padding: 0;">
                        <div class="settings-content-wrapper">
                            <div class="settings-sidebar-nav">
                                <div class="settings-nav-item active" data-panel="volume-sync">音量同步</div>
                                <div class="settings-nav-item" data-panel="console">检查控制台</div>
                            </div>
                            <div class="settings-content">
                                <!-- 音量同步面板 -->
                                <div class="settings-content-panel active" id="panel-volume-sync">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <div class="checkbox-wrapper">
                                                    <input type="checkbox" id="volume-sync-enabled" ${volumeSyncEnabled ? 'checked' : ''}>
                                                    <label for="volume-sync-enabled">启用音量自动平衡</label>
                                                </div>
                                            </div>

                                            <div class="setting-item">
                                                <label>目标响度</label>
                                                <div class="range-container">
                                                    <input type="range" id="volume-target-lufs" min="-24" max="-12" value="${targetLufs}" step="1">
                                                    <span id="volume-target-value">${targetLufs} LUFS</span>
                                                </div>
                                                <small>值越大越响亮，-16 为流媒体标准</small>
                                            </div>

                                            <div class="setting-stats">
                                                <div class="stat-item">
                                                    <span class="stat-label">已分析</span>
                                                    <span class="stat-value">${volumeStats.analyzed} 首</span>
                                                </div>
                                                <div class="stat-item">
                                                    <span class="stat-label">未分析</span>
                                                    <span class="stat-value">${volumeStats.unanalyzed} 首</span>
                                                </div>
                                                <div class="stat-item">
                                                    <span class="stat-label">总计</span>
                                                    <span class="stat-value">${volumeStats.total} 首</span>
                                                </div>
                                            </div>

                                            <div class="setting-actions">
                                                <button class="btn btn-secondary" id="batch-analyze-btn" ${volumeStats.unanalyzed === 0 ? 'disabled' : ''}>
                                                    批量同步所有歌曲
                                                </button>
                                                <button class="btn btn-secondary" id="reset-volume-btn">重置为默认</button>
                                            </div>

                                            <div class="settings-save-section">
                                                <button class="btn btn-primary" id="save-settings-btn">保存并应用</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 检查控制台面板 -->
                                <div class="settings-content-panel" id="panel-console">
                                    <div class="console-actions">
                                        <button id="refresh-ui-btn" class="btn btn-success">刷新界面</button>
                                        <button id="check-songs-btn" class="btn btn-primary">检查歌曲文件状态</button>
                                        <button id="clean-missing-btn" class="btn btn-warning">清理缺失文件</button>
                                        <button id="check-ui-btn" class="btn btn-info">检查UI状态</button>
                                        <button id="reset-search-btn" class="btn btn-warning">重置搜索框</button>
                                        <button id="diagnose-tools-btn" class="btn btn-info">诊断工具状态</button>
                                        <button id="force-download-btn" class="btn btn-warning">强制重新下载工具</button>
                                        <button id="open-devtools-btn" class="btn btn-secondary">打开开发者工具</button>
                                    </div>
                                    <div id="console-output" class="console-output"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <span style="font-size: 12px; color: var(--text-muted);">当前版本: ${versionText}</span>
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            // ==================== 侧边导航切换 ====================
            const navItems = dialog.querySelectorAll('.settings-nav-item');
            const panels = dialog.querySelectorAll('.settings-content-panel');

            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    const targetPanel = item.dataset.panel;

                    // 更新导航状态
                    navItems.forEach(nav => nav.classList.remove('active'));
                    item.classList.add('active');

                    // 切换面板
                    panels.forEach(panel => {
                        panel.classList.remove('active');
                        if (panel.id === `panel-${targetPanel}`) {
                            panel.classList.add('active');
                        }
                    });
                });
            });

            // ==================== 音量同步事件绑定 ====================
            const targetLufsInput = document.getElementById('volume-target-lufs');
            const targetLufsValue = document.getElementById('volume-target-value');

            // 滑块值变化
            if (targetLufsInput && targetLufsValue) {
                targetLufsInput.addEventListener('input', (e) => {
                    targetLufsValue.textContent = `${e.target.value} LUFS`;
                });
            }

            // 保存并应用按钮
            const saveBtn = document.getElementById('save-settings-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    try {
                        const newTargetLufs = parseInt(targetLufsInput.value);
                        const newVolumeSyncEnabled = document.getElementById('volume-sync-enabled').checked;

                        // 保存设置
                        await electronAPI.database.setSetting('volume_target_lufs', newTargetLufs);
                        await electronAPI.database.setSetting('volume_sync_enabled', newVolumeSyncEnabled);

                        // 检查目标响度是否改变
                        if (newTargetLufs !== targetLufs) {
                            // 目标响度改变了，批量更新已分析歌曲的增益值
                            this.showMessage('正在更新所有已分析歌曲的音量增益...', 'info');

                            const result = await electronAPI.volume.batchUpdateGains(newTargetLufs);

                            if (result.updated > 0) {
                                this.showMessage(`设置已保存，已更新 ${result.updated} 首歌曲的音量增益`, 'success');
                                // 刷新当前视图
                                await this.refreshCurrentView();
                            } else {
                                this.showMessage('设置已保存', 'success');
                            }
                        } else {
                            this.showMessage('设置已保存', 'success');
                        }

                        dialog.remove();
                    } catch (error) {
                        logger.error('保存设置失败:', error);
                        this.showMessage('保存设置失败', 'error');
                    }
                });
            }

            // 批量分析按钮
            const batchAnalyzeBtn = document.getElementById('batch-analyze-btn');
            if (batchAnalyzeBtn && volumeStats.unanalyzed > 0) {
                batchAnalyzeBtn.addEventListener('click', () => {
                    dialog.remove();
                    this.showBatchAnalyzeDialog();
                });
            }

            // 重置为默认按钮
            const resetBtn = document.getElementById('reset-volume-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', async () => {
                    if (targetLufsInput) {
                        targetLufsInput.value = -16;
                        targetLufsValue.textContent = '-16 LUFS';
                    }
                });
            }

            // ==================== 检查控制台事件绑定 ====================
            const output = dialog.querySelector('#console-output');
            const refreshUIBtn = dialog.querySelector('#refresh-ui-btn');
            const checkSongsBtn = dialog.querySelector('#check-songs-btn');
            const cleanMissingBtn = dialog.querySelector('#clean-missing-btn');
            const checkUIBtn = dialog.querySelector('#check-ui-btn');
            const resetSearchBtn = dialog.querySelector('#reset-search-btn');
            const diagnoseToolsBtn = dialog.querySelector('#diagnose-tools-btn');
            const forceDownloadBtn = dialog.querySelector('#force-download-btn');
            const openDevToolsBtn = dialog.querySelector('#open-devtools-btn');

            if (refreshUIBtn) {
                refreshUIBtn.addEventListener('click', async () => {
                    output.innerHTML = '<p>正在刷新界面...</p>';
                    try {
                        await this.refreshUI();
                        output.innerHTML = '<p style="color: green;">✅ 界面刷新成功！</p>';
                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ 界面刷新失败: ${error.message}</p>`;
                    }
                });
            }

            if (checkSongsBtn) {
                checkSongsBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = '<p>正在检查歌曲文件状态...</p>';
                        const missingFiles = await electronAPI.file.checkSongsStatus();

                        if (missingFiles.length === 0) {
                            output.innerHTML = '<p style="color: green;">✅ 所有歌曲文件都存在！</p>';
                        } else {
                            let html = `<p style="color: orange;">⚠️ 发现 ${missingFiles.length} 个缺失文件:</p><ul>`;
                            missingFiles.forEach(file => {
                                html += `<li>${file.title} - ${file.path}</li>`;
                            });
                            html += '</ul>';
                            output.innerHTML = html;
                        }
                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ 检查失败: ${error.message}</p>`;
                    }
                });
            }

            if (cleanMissingBtn) {
                cleanMissingBtn.addEventListener('click', async () => {
                    if (confirm('确定要清理所有缺失的文件记录吗？这将从数据库中移除文件不存在的歌曲记录。')) {
                        try {
                            output.innerHTML = '<p>正在清理缺失文件...</p>';
                            const result = await electronAPI.file.cleanMissingSongs();

                            output.innerHTML = `<p style="color: green;">✅ 清理完成！共清理了 ${result.cleanedCount} 个缺失文件记录。</p>`;

                            // 刷新音乐库
                            await this.loadMusicLibrary();
                            await this.loadPlaylistsToSidebar();
                        } catch (error) {
                            output.innerHTML = `<p style="color: red;">❌ 清理失败: ${error.message}</p>`;
                        }
                    }
                });
            }

            if (openDevToolsBtn) {
                openDevToolsBtn.addEventListener('click', () => {
                    if (electronAPI.window?.openDevTools) {
                        electronAPI.window.openDevTools();
                        this.showMessage('开发者工具已打开', 'info');
                    } else {
                        this.showMessage('无法打开开发者工具', 'error');
                    }
                });
            }

            if (checkUIBtn) {
                checkUIBtn.addEventListener('click', () => {
                    try {
                        const searchInput = document.getElementById('search-input');
                        const audioPlayer = document.getElementById('audio-player');

                        let html = '<h4>UI状态检查结果:</h4>';

                        // 检查搜索框
                        if (searchInput) {
                            html += `<p><strong>搜索框:</strong> ✅ 存在</p>`;
                            html += `<p>- 可见性: ${searchInput.style.display !== 'none' ? '✅ 可见' : '❌ 隐藏'}</p>`;
                            html += `<p>- 是否禁用: ${searchInput.disabled ? '❌ 禁用' : '✅ 启用'}</p>`;
                            html += `<p>- tabIndex: ${searchInput.tabIndex}</p>`;
                            html += `<p>- 当前焦点: ${document.activeElement === searchInput ? '✅ 有焦点' : '❌ 无焦点'}</p>`;
                            html += `<p>- 事件监听器: ${searchInput.onkeyup || searchInput.oninput ? '✅ 已绑定' : '❌ 未绑定'}</p>`;
                        } else {
                            html += `<p><strong>搜索框:</strong> ❌ 不存在</p>`;
                        }

                        // 检查音频播放器
                        if (audioPlayer) {
                            html += `<p><strong>音频播放器:</strong> ✅ 存在</p>`;
                            html += `<p>- 状态: ${audioPlayer.readyState}</p>`;
                        } else {
                            html += `<p><strong>音频播放器:</strong> ❌ 不存在</p>`;
                        }

                        // 检查播放器状态
                        html += `<p><strong>播放器状态:</strong></p>`;
                        html += `<p>- 当前歌曲: ${this.currentSong ? this.currentSong.title : '无'}</p>`;
                        html += `<p>- 播放列表长度: ${this.playlist.length}</p>`;
                        html += `<p>- 是否在播放: ${this.isPlaying ? '✅ 是' : '❌ 否'}</p>`;

                        output.innerHTML = html;
                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ UI状态检查失败: ${error.message}</p>`;
                    }
                });
            }

            if (resetSearchBtn) {
                resetSearchBtn.addEventListener('click', () => {
                    try {
                        output.innerHTML = '<p>正在重置搜索框...</p>';

                        // 强制重新设置搜索框
                        if (this.setupSearchInput()) {
                            output.innerHTML = '<p style="color: green;">✅ 搜索框重置成功！请尝试点击搜索框输入。</p>';
                        } else {
                            output.innerHTML = '<p style="color: red;">❌ 搜索框重置失败，元素未找到。</p>';
                        }
                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ 搜索框重置失败: ${error.message}</p>`;
                    }
                });
            }

            if (diagnoseToolsBtn) {
                diagnoseToolsBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = '<p>正在诊断工具状态...</p>';

                        const tools = ['yt-dlp', 'ffmpeg'];
                        let html = '<h4>工具诊断结果:</h4>';

                        for (const tool of tools) {
                            const diagnosis = await electronAPI.tools.diagnose(tool);

                            html += `<div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">`;
                            html += `<h5>${tool.toUpperCase()}</h5>`;
                            html += `<p><strong>工具路径:</strong> ${diagnosis.toolPath || '未知'}</p>`;
                            html += `<p><strong>平台:</strong> ${diagnosis.platform}</p>`;
                            html += `<p><strong>bin目录存在:</strong> ${diagnosis.binDirExists ? '✅ 是' : '❌ 否'}</p>`;
                            html += `<p><strong>文件存在:</strong> ${diagnosis.fileExists ? '✅ 是' : '❌ 否'}</p>`;

                            if (diagnosis.fileExists) {
                                html += `<p><strong>文件大小:</strong> ${diagnosis.fileSize} 字节</p>`;
                                html += `<p><strong>执行权限:</strong> ${diagnosis.hasPermissions ? '✅ 有' : '❌ 无'}</p>`;
                            }

                            html += `<p><strong>系统工具可用:</strong> ${diagnosis.systemToolAvailable ? '✅ 是' : '❌ 否'}</p>`;

                            if (diagnosis.issues.length > 0) {
                                html += `<p><strong>问题:</strong></p><ul>`;
                                diagnosis.issues.forEach(issue => {
                                    html += `<li style="color: red;">${issue}</li>`;
                                });
                                html += `</ul>`;
                            }

                            if (diagnosis.recommendations.length > 0) {
                                html += `<p><strong>建议:</strong></p><ul>`;
                                diagnosis.recommendations.forEach(rec => {
                                    html += `<li style="color: blue;">${rec}</li>`;
                                });
                                html += `</ul>`;
                            }

                            html += `</div>`;
                        }

                        output.innerHTML = html;
                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ 诊断失败: ${error.message}</p>`;
                    }
                });
            }

            if (forceDownloadBtn) {
                forceDownloadBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = '<p>正在强制重新下载工具...</p>';

                        const tools = ['yt-dlp', 'ffmpeg'];
                        let html = '<h4>强制重新下载结果:</h4>';

                        for (const tool of tools) {
                            try {
                                html += `<p>正在下载 ${tool}...</p>`;
                                output.innerHTML = html;

                                const result = await electronAPI.tools.forceDownload(tool);

                                if (result.success) {
                                    html += `<p style="color: green;">✅ ${tool} 重新下载成功</p>`;
                                } else {
                                    html += `<p style="color: red;">❌ ${tool} 重新下载失败: ${result.message}</p>`;
                                }
                            } catch (error) {
                                html += `<p style="color: red;">❌ ${tool} 重新下载失败: ${error.message}</p>`;
                            }

                            output.innerHTML = html;
                        }

                        html += '<p><strong>下载完成！请重试您的操作。</strong></p>';
                        output.innerHTML = html;

                    } catch (error) {
                        output.innerHTML = `<p style="color: red;">❌ 强制重新下载失败: ${error.message}</p>`;
                    }
                });
            }

        } catch (error) {
            logger.error('显示设置对话框失败:', error);
            this.showMessage('无法打开设置', 'error');
        }
    }

    // 显示批量分析对话框
    async showBatchAnalyzeDialog() {
        try {
            const unanalyzedSongs = await electronAPI.volume.getUnanalyzedSongs();

            if (!unanalyzedSongs || unanalyzedSongs.length === 0) {
                this.showMessage('没有需要同步的歌曲', 'info');
                return;
            }

            const totalSongs = unanalyzedSongs.length;
            let currentSongIndex = 0;
            let isPaused = false;
            let isCancelled = false;
            let successCount = 0;
            let failCount = 0;

            const targetLufs = await electronAPI.database.getSetting('volume_target_lufs', -16);

            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content" style="max-width: 450px;">
                    <div class="modal-header">
                        <h3>正在同步歌曲音量</h3>
                        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="batch-analyze-progress">
                            <div class="progress-bar-container">
                                <div class="batch-analyze-progress-bar" id="analyze-progress-bar" style="width: 0%"></div>
                            </div>
                            <div class="analyze-stats">
                                <p>当前歌曲：<strong id="current-song-name">准备中...</strong></p>
                                <p>进度：<span id="analyze-progress-text">0 / ${totalSongs}</span></p>
                            </div>
                            <div class="analyze-result-stats">
                                <div class="stat-item">
                                    <span class="stat-label">成功</span>
                                    <span class="stat-value" id="success-count">0</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">失败</span>
                                    <span class="stat-value" id="fail-count">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="pause-analyze-btn">暂停</button>
                        <button class="btn btn-secondary" id="cancel-analyze-btn">取消</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            // 控制按钮
            const pauseBtn = document.getElementById('pause-analyze-btn');
            const cancelBtn = document.getElementById('cancel-analyze-btn');

            if (pauseBtn) {
                pauseBtn.addEventListener('click', () => {
                    isPaused = !isPaused;
                    pauseBtn.textContent = isPaused ? '继续' : '暂停';
                });
            }

            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    isCancelled = true;
                    dialog.remove();
                });
            }

            // 分析函数
            const analyzeNext = async () => {
                if (isCancelled || currentSongIndex >= totalSongs) {
                    // 完成
                    setTimeout(() => {
                        dialog.remove();
                        this.showMessage(`批量同步完成！成功：${successCount}，失败：${failCount}`, 'success');
                        // 智能刷新当前视图
                        this.refreshCurrentView();
                    }, 500);
                    return;
                }

                if (isPaused) {
                    setTimeout(analyzeNext, 100);
                    return;
                }

                const song = unanalyzedSongs[currentSongIndex];
                const progressPercent = (currentSongIndex / totalSongs) * 100;

                // 更新UI
                const progressBar = document.getElementById('analyze-progress-bar');
                const progressText = document.getElementById('analyze-progress-text');
                const songNameEl = document.getElementById('current-song-name');
                const successCountEl = document.getElementById('success-count');
                const failCountEl = document.getElementById('fail-count');

                if (progressBar) progressBar.style.width = `${progressPercent}%`;
                if (progressText) progressText.textContent = `${currentSongIndex + 1} / ${totalSongs}`;
                if (songNameEl) songNameEl.textContent = song.title;

                try {
                    const result = await electronAPI.volume.analyzeSong(song.id, targetLufs);
                    if (result.success) {
                        successCount++;
                        if (successCountEl) successCountEl.textContent = successCount;
                    } else {
                        failCount++;
                        if (failCountEl) failCountEl.textContent = failCount;
                    }
                } catch (error) {
                    logger.error(`同步歌曲失败: ${song.title}`, error);
                    failCount++;
                    if (failCountEl) failCountEl.textContent = failCount;
                }

                currentSongIndex++;
                setTimeout(analyzeNext, 100); // 短暂延迟，让UI有机会更新
            };

            // 开始分析
            analyzeNext();

        } catch (error) {
            logger.error('批量同步失败:', error);
            this.showMessage('批量同步失败', 'error');
        }
    }

    async deleteSong(songId) {
        if (confirm('确定要删除这首歌曲吗？这将永久删除歌曲文件和数据库记录，无法恢复。删除之后请手动切屏一次，否则无法正常显示')) {
            try {
                // 如果删除的是当前播放的歌曲，先停止播放避免错误提示
                if (this.currentSong && this.currentSong.id === songId) {
                    this.audio.pause();
                    this.audio.src = '';
                    this.audio.load();
                    this.currentSong = null;
                    this.currentIndex = -1;
                    this.updateCurrentSongInfo();
                }
                
                // 调用删除方法
                const result = await electronAPI.database.removeSong(songId);
                
                // 处理删除结果
                if (result && result.success) {
                    // 在控制台记录详细的删除状态（用于调试）
                    if (result.fileDeleted) {
                        console.log('✅ 音频文件已删除');
                    } else if (result.songPath) {
                        console.warn('⚠️ 音频文件删除失败或不存在，路径:', result.songPath);
                    }
                    
                    if (result.thumbnailDeleted) {
                        console.log('✅ 缩略图已删除');
                    } else if (result.thumbnailPath) {
                        console.warn('⚠️ 缩略图删除失败或不存在，路径:', result.thumbnailPath);
                    }
                    
                    // 只显示简单的成功提示给用户
                    this.showMessage('歌曲删除成功', 'success');
                } else {
                    this.showMessage('歌曲删除成功', 'success');
                }
                
                // 重新加载当前视图
                await this.loadMusicLibrary();
                
                // 重新加载歌单列表以更新歌曲数量
                await this.loadPlaylistsToSidebar();
                
            } catch (error) {
                logger.error('删除歌曲失败:', error);
                this.showMessage('删除失败: ' + error.message, 'error');
            }
        }
    }

    async checkFileStatus(filePath) {
        try {
            const status = await electronAPI.file.checkFileStatus(filePath);
            let message = `文件 "${filePath}" 状态: ${status.exists ? '存在' : '不存在'}`;
            if (status.exists) {
                message += `\n文件大小: ${utils.formatBytes(status.size)}`;
                message += `\n修改时间: ${new Date(status.modifiedTime).toLocaleString()}`;
            }
            this.showMessage(message, 'info');
        } catch (error) {
            logger.error('检查文件状态失败:', error);
            this.showMessage('检查文件状态失败: ' + error.message, 'error');
        }
    }

    // 消息提示
    showMessage(text, type = 'info') {
        const container = document.getElementById('message-container');
        if (!container) return;

        const message = dom.createElement('div', {
            className: `message ${type}`,
            textContent: text
        });

        container.appendChild(message);

        // 3秒后自动移除
        setTimeout(() => {
            if (message.parentNode) {
                message.parentNode.removeChild(message);
            }
        }, 3000);
    }

    // 刷新界面
    async refreshUI() {
        try {
            logger.info('开始刷新界面');
            this.showMessage('正在刷新界面...', 'info');

            // 重新加载歌单列表
            await this.loadPlaylistsToSidebar();

            // 智能刷新当前视图（会正确处理歌单、最近播放、所有歌曲等）
            await this.refreshCurrentView();

            // 重新设置搜索框（确保输入功能正常）
            this.setupSearchInput();

            logger.info('界面刷新完成');
            this.showMessage('界面刷新成功', 'success');

        } catch (error) {
            logger.error('界面刷新失败:', error);
            this.showMessage('界面刷新失败: ' + error.message, 'error');
        }
    }
    
    // 设置全局快捷键
    setupGlobalShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+R 刷新界面
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                this.refreshUI();
            }
            
            // Ctrl+Shift+R 重置搜索框
            if (e.ctrlKey && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                this.setupSearchInput();
                this.showMessage('搜索框已重置', 'info');
            }
            
            // Ctrl+Shift+I 打开开发者工具
            if (e.ctrlKey && e.shiftKey && e.key === 'I') {
                e.preventDefault();
                if (electronAPI.window?.openDevTools) {
                    electronAPI.window.openDevTools();
                }
            }
            
            // F12 打开开发者工具
            if (e.key === 'F12') {
                e.preventDefault();
                if (electronAPI.window?.openDevTools) {
                    electronAPI.window.openDevTools();
                }
            }
            
            // 空格键播放/暂停（当焦点不在输入框时）
            if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                this.togglePlay();
            }
        });
    }
    

    


    // 为输入框显示右键菜单
    showInputContextMenu(event, inputElement) {
        // 移除现有的右键菜单
        const existingMenu = document.querySelector('.input-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        // 创建右键菜单
        const menu = document.createElement('div');
        menu.className = 'context-menu input-context-menu';
        menu.innerHTML = `
            <div class="menu-item" data-action="paste">粘贴</div>
            <div class="menu-item" data-action="cut">剪切</div>
            <div class="menu-item" data-action="copy">复制</div>
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="select-all">全选</div>
            <div class="menu-item" data-action="clear">清空</div>
        `;
        
        // 设置菜单位置
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;
        
        document.body.appendChild(menu);
        
        // 点击菜单项
        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                await this.handleInputContextAction(action, inputElement);
            }
            menu.remove();
        });
        
        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }
    
    // 处理输入框右键菜单操作
    async handleInputContextAction(action, inputElement) {
        try {
            // 确保输入框获得焦点
            inputElement.focus();
            
            switch (action) {
                case 'paste':
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        try {
                            // 检查文档是否有焦点
                            if (!document.hasFocus()) {
                                this.showMessage('请先点击窗口以获得焦点', 'warning');
                                return;
                            }
                            const text = await navigator.clipboard.readText();
                            inputElement.value = text;
                            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                        } catch (clipboardError) {
                            console.warn('剪贴板API失败，尝试使用execCommand:', clipboardError);
                            // 回退到execCommand
                            try {
                                document.execCommand('paste');
                            } catch (execError) {
                                this.showMessage('粘贴失败：无法访问剪贴板', 'error');
                            }
                        }
                    } else {
                        // 兼容旧版浏览器
                        try {
                            document.execCommand('paste');
                        } catch (execError) {
                            this.showMessage('粘贴失败：浏览器不支持', 'error');
                        }
                    }
                    break;
                case 'cut':
                    inputElement.select();
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        try {
                            if (!document.hasFocus()) {
                                this.showMessage('请先点击窗口以获得焦点', 'warning');
                                return;
                            }
                            await navigator.clipboard.writeText(inputElement.value);
                            inputElement.value = '';
                        } catch (clipboardError) {
                            console.warn('剪贴板API失败，尝试使用execCommand:', clipboardError);
                            try {
                                document.execCommand('cut');
                            } catch (execError) {
                                this.showMessage('剪切失败：无法访问剪贴板', 'error');
                            }
                        }
                    } else {
                        try {
                            document.execCommand('cut');
                        } catch (execError) {
                            this.showMessage('剪切失败：浏览器不支持', 'error');
                        }
                    }
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                    break;
                case 'copy':
                    inputElement.select();
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        try {
                            if (!document.hasFocus()) {
                                this.showMessage('请先点击窗口以获得焦点', 'warning');
                                return;
                            }
                            await navigator.clipboard.writeText(inputElement.value);
                            this.showMessage('已复制到剪贴板', 'success');
                        } catch (clipboardError) {
                            console.warn('剪贴板API失败，尝试使用execCommand:', clipboardError);
                            try {
                                document.execCommand('copy');
                                this.showMessage('已复制到剪贴板', 'success');
                            } catch (execError) {
                                this.showMessage('复制失败：无法访问剪贴板', 'error');
                            }
                        }
                    } else {
                        try {
                            document.execCommand('copy');
                            this.showMessage('已复制到剪贴板', 'success');
                        } catch (execError) {
                            this.showMessage('复制失败：浏览器不支持', 'error');
                        }
                    }
                    break;
                case 'select-all':
                    inputElement.select();
                    break;
                case 'clear':
                    inputElement.value = '';
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                    break;
            }
        } catch (error) {
            console.error('输入框操作失败:', error);
            this.showMessage('操作失败: ' + error.message, 'error');
        }
    }
}

// 全局实例
let player;

// 初始化
dom.ready(() => {
    logger.info('开始初始化音乐播放器');
    player = new MusicPlayer();
    
    // 将播放器实例添加到全局作用域，供HTML中的事件处理器使用
    window.player = player;
});


