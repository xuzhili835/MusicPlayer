// 播放核心与播放器 UI（mixin：挂载到 MusicPlayer.prototype）
// 播放模式三态：sequence 顺序 / shuffle 随机 / single 单曲循环
window.PlayerUI = {
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
    },

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

            logger.info('播放:', this.currentSong.title);
        } catch (error) {
            logger.error('播放失败:', error);
            this.showMessage('播放失败: ' + this.currentSong.title, 'error');
        }
    },

    async previousSong() {
        if (this.playlist.length === 0) return;

        const prevIndex = this.getPreviousSongIndex();
        if (prevIndex !== -1) {
            await this.playSong(prevIndex);
        }
    },

    getNextSongIndex() {
        if (this.playlist.length === 0) return -1;

        switch (this.playMode) {
            case 'shuffle':
                // 随机播放（避免重复当前曲目）
                if (this.playlist.length === 1) return 0;
                let randomIndex;
                do {
                    randomIndex = Math.floor(Math.random() * this.playlist.length);
                } while (randomIndex === this.currentIndex);
                return randomIndex;

            case 'single':
            case 'sequence':
            default:
                // 顺序播放（单曲循环在 ended 事件中处理）
                return this.currentIndex < this.playlist.length - 1 ? this.currentIndex + 1 : -1;
        }
    },

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

            case 'single':
            case 'sequence':
            default:
                // 顺序播放，到边界回绕
                return this.currentIndex > 0 ? this.currentIndex - 1 : this.playlist.length - 1;
        }
    },

    async nextSong() {
        if (this.playlist.length === 0) return;

        const nextIndex = this.getNextSongIndex();
        if (nextIndex !== -1) {
            await this.playSong(nextIndex);
        } else {
            // 顺序播放到达末尾，回到开头
            await this.playSong(0);
        }
    },

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
            default:
                await this.nextSong();
                break;
        }
    },

    // 播放模式控制（单按钮三态循环：顺序 → 随机 → 单曲循环）
    togglePlayMode() {
        const modes = ['sequence', 'shuffle', 'single'];
        const currentIndex = modes.indexOf(this.playMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.playMode = modes[nextIndex];

        this.updatePlayModeButtons();
        this.saveSettings();
        this.showMessage(this.getPlayModeText(), 'info');
    },

    setPlayMode(mode) {
        const validModes = ['sequence', 'shuffle', 'single'];
        if (validModes.includes(mode)) {
            this.playMode = mode;
            this.updatePlayModeButtons();
            this.saveSettings();
        }
    },

    getPlayModeText() {
        const texts = {
            'sequence': '顺序播放',
            'shuffle': '随机播放',
            'single': '单曲循环'
        };
        return texts[this.playMode] || '顺序播放';
    },

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
    },

    toggleMute() {
        if (this.volume > 0) {
            this.lastVolume = this.volume;
            this.setVolume(0);
        } else {
            this.setVolume(this.lastVolume || 50);
        }
    },

    // 应用音量补偿（EBU R128 增益）
    async applyVolumeCompensation() {
        if (!this.currentSong || !this.audio) return;

        try {
            const volumeSyncEnabled = await electronAPI.database.getSetting('volume_sync_enabled', true);

            if (!volumeSyncEnabled) {
                this.audio.volume = this.volume / 100;
                return;
            }

            if (this.currentSong.volume_gain !== null && this.currentSong.volume_gain !== undefined) {
                const baseVolume = this.volume / 100;
                const gain = this.currentSong.volume_gain;
                const compensatedVolume = baseVolume * Math.pow(10, gain / 20);
                this.audio.volume = Math.max(0, Math.min(1, compensatedVolume));
            } else {
                this.audio.volume = this.volume / 100;
            }
        } catch (error) {
            this.audio.volume = this.volume / 100;
        }
    },

    // 同步歌曲音量
    async analyzeSongVolume(songId) {
        try {
            this.showMessage('正在同步音量...', 'info');

            const targetLufs = await electronAPI.database.getSetting('volume_target_lufs', -16);
            const result = await electronAPI.volume.analyzeSong(songId, targetLufs);

            if (result.success) {
                this.showMessage(`音量同步完成：${result.volumeGain > 0 ? '+' : ''}${result.volumeGain.toFixed(1)} dB`, 'success');
                await this.refreshCurrentView();
            } else {
                this.showMessage(`音量同步失败：${result.error || '未知错误'}`, 'error');
            }
        } catch (error) {
            logger.error('同步音量失败:', error);
            this.showMessage('音量同步失败', 'error');
        }
    },

    // 进度条跳转
    seekTo(event) {
        if (!this.audio || !this.audio.duration) return;

        const progressContainer = event.currentTarget;
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const targetTime = percent * this.audio.duration;

        this.audio.currentTime = targetTime;
    },

    // ---------- 播放器 UI 更新 ----------

    updatePlayButton(state) {
        const playBtn = document.getElementById('play-btn');
        if (!playBtn) return;

        switch (state) {
            case 'playing':
                playBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>`;
                playBtn.title = '暂停';
                playBtn.setAttribute('aria-label', '暂停');
                break;
            case 'paused':
                playBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>`;
                playBtn.title = '播放';
                playBtn.setAttribute('aria-label', '播放');
                break;
            case 'loading':
                playBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M12 7v5l3 3"/>
                </svg>`;
                playBtn.title = '加载中';
                break;
        }
    },

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
    },

    updateTimeDisplay() {
        const currentTime = document.getElementById('current-time');
        const totalTime = document.getElementById('total-time');

        if (currentTime && this.audio) {
            currentTime.textContent = utils.formatTime(this.audio.currentTime);
        }

        if (totalTime && this.audio) {
            totalTime.textContent = utils.formatTime(this.audio.duration);
        }
    },

    updateCurrentSongInfo() {
        const titleElement = document.getElementById('current-title');
        const artistElement = document.getElementById('current-artist');
        const coverElement = document.getElementById('current-cover');

        if (this.currentSong) {
            if (titleElement) {
                titleElement.textContent = this.currentSong.title;
                titleElement.title = this.currentSong.title;
            }
            if (artistElement) {
                artistElement.textContent = this.currentSong.artist || '未知艺术家';
            }
            if (coverElement) {
                this.updateAlbumCover(coverElement, this.currentSong);
            }
        } else {
            if (titleElement) {
                titleElement.textContent = '未选择内容';
                titleElement.title = '';
            }
            if (artistElement) {
                artistElement.textContent = '--';
            }
            if (coverElement) {
                this.setDefaultAlbumCover(coverElement);
            }
        }
    },

    // 更新封面
    updateAlbumCover(coverElement, song) {
        coverElement.style.opacity = '0.5';

        if (song.thumbnail) {
            const src = this.resolveMediaUrl(song.thumbnail);

            const img = new Image();
            img.onload = () => {
                coverElement.src = src;
                coverElement.style.opacity = '1';
                coverElement.classList.remove('cover-error');
            };
            img.onerror = () => {
                console.warn('封面加载失败:', song.thumbnail);
                this.setDefaultAlbumCover(coverElement);
                coverElement.classList.add('cover-error');
            };

            img.src = src;
        } else {
            this.setDefaultAlbumCover(coverElement);
        }
    },

    // 解析媒体地址：本地绝对路径转 file:// URL，网络/data 地址原样返回
    resolveMediaUrl(src) {
        if (!src) return null;
        if (/^(https?|data|blob|file):/i.test(src)) return src;
        return 'file:///' + String(src).replace(/\\/g, '/').replace(/^\/+/, '');
    },

    setDefaultAlbumCover(coverElement) {
        coverElement.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 24 24' fill='%23999'%3E%3Cpath d='M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z'/%3E%3C/svg%3E";
        coverElement.style.opacity = '1';
    },

    updateCurrentSongHighlight() {
        const songItems = document.querySelectorAll('.song-item');
        songItems.forEach(item => {
            item.classList.remove('playing');
            item.setAttribute('aria-selected', 'false');
        });

        if (this.currentSong) {
            const currentItem = document.querySelector(`[data-song-id="${this.currentSong.id}"]`);
            if (currentItem) {
                currentItem.classList.add('playing');
                currentItem.setAttribute('aria-selected', 'true');
            }
        }
    },

    // 更新播放模式按钮（单按钮三态）
    updatePlayModeButtons() {
        const btn = document.getElementById('play-mode-btn');
        if (!btn) return;

        const icons = {
            sequence: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17,1 21,5 17,9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7,23 3,19 7,15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>`,
            shuffle: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16,3 21,3 21,8"/>
                <path d="M4 20L21 3"/>
                <polyline points="21,16 21,21 16,21"/>
                <path d="M15 15L21 21"/>
                <path d="M4 4L9 9"/>
            </svg>`,
            single: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17,1 21,5 17,9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7,23 3,19 7,15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                <text x="12" y="16" text-anchor="middle" font-size="10" fill="currentColor" stroke="none" font-weight="700">1</text>
            </svg>`
        };

        btn.innerHTML = icons[this.playMode] || icons.sequence;
        btn.title = this.getPlayModeText() + '（点击切换）';
        btn.setAttribute('aria-label', btn.title);
        btn.classList.toggle('active', this.playMode !== 'sequence');
    },

    updateVolumeButton() {
        const volumeBtn = document.getElementById('volume-btn');
        if (volumeBtn) {
            if (this.volume === 0) {
                volumeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <line x1="23" y1="9" x2="17" y2="15"/>
                    <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>`;
                volumeBtn.title = '取消静音';
            } else if (this.volume < 50) {
                volumeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>`;
                volumeBtn.title = '静音';
            } else {
                volumeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>`;
                volumeBtn.title = '静音';
            }
        }
    },

    // 随机播放全部
    shuffleAll() {
        if (this.playlist.length === 0) return;

        this.setPlayMode('shuffle');
        this.playSong(Math.floor(Math.random() * this.playlist.length));
    }
};
