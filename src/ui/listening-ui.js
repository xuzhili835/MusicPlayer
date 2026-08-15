// 听力与播客特性（mixin：挂载到 MusicPlayer.prototype）
// 倍速播放 / A-B 复读 / 睡眠定时 / 进度条拖拽 / 随机播放队列
window.ListeningUI = {
    // ==================== 倍速播放 ====================

    // 可选倍速档位（听力场景）
    SPEED_PRESETS: [0.5, 0.75, 1, 1.25, 1.5, 2, 3],

    // 初始化倍速（loadSettings 后调用）
    initPlaybackRate() {
        this.playbackRate = storage.get('playbackRate', 1);
        if (!this.SPEED_PRESETS.includes(this.playbackRate)) {
            this.playbackRate = 1;
        }
        this.applyPlaybackRate();
    },

    applyPlaybackRate() {
        if (this.audio) {
            this.audio.playbackRate = this.playbackRate;
            // 变速不变调（听力跟读必需）
            this.audio.preservesPitch = true;
            try { this.audio.mozPreservesPitch = true; } catch (e) { /* 忽略 */ }
        }

        const btn = document.getElementById('speed-btn');
        if (btn) {
            const label = this.playbackRate === 1 ? '1.0x' : `${this.playbackRate}x`;
            btn.textContent = label;
            btn.classList.toggle('active', this.playbackRate !== 1);
            btn.title = `播放速度：${label}（变速不变调）`;
        }
    },

    setPlaybackRate(rate) {
        this.playbackRate = rate;
        storage.set('playbackRate', rate);
        this.applyPlaybackRate();
        this.showMessage(`播放速度：${rate === 1 ? '1.0x' : rate + 'x'}`, 'info');
    },

    // 倍速选择菜单
    showSpeedMenu(anchorBtn) {
        this.closePopoverMenu();

        const menu = document.createElement('div');
        menu.className = 'popover-menu';
        menu.id = 'popover-menu';

        this.SPEED_PRESETS.forEach(rate => {
            const item = document.createElement('div');
            item.className = 'menu-item' + (rate === this.playbackRate ? ' checked' : '');
            item.innerHTML = `<span>${rate === 1 ? '1.0x 正常' : rate + 'x'}</span>${rate === this.playbackRate ? '<span>✓</span>' : ''}`;
            item.addEventListener('click', () => {
                this.setPlaybackRate(rate);
                this.closePopoverMenu();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.positionPopover(menu, anchorBtn);
    },

    // ==================== A-B 复读 ====================

    // 状态机：null → 设A → 设B（开始循环）→ 清除
    toggleABLoop(action) {
        if (!this.audio || !this.audio.duration) return;

        if (action === 'setA') {
            this.loopA = this.audio.currentTime;
            this.loopB = null;
            this.updateABRegion();
            this.showMessage(`复读起点 A：${utils.formatTime(this.loopA)}（再按 ] 设置终点）`, 'info');
        } else if (action === 'setB') {
            if (this.loopA === null) {
                this.showMessage('请先设置复读起点 A（按 [ 或点击 A-B 按钮）', 'warning');
                return;
            }
            let b = this.audio.currentTime;
            if (b <= this.loopA) {
                this.showMessage('终点 B 需在起点 A 之后', 'warning');
                return;
            }
            this.loopB = b;
            this.updateABRegion();
            this.showMessage(`复读区间：${utils.formatTime(this.loopA)} - ${utils.formatTime(this.loopB)}（按 \\ 清除）`, 'success');
        } else if (action === 'clear') {
            if (this.loopA === null && this.loopB === null) return;
            this.loopA = null;
            this.loopB = null;
            this.updateABRegion();
            this.showMessage('已清除复读区间', 'info');
        } else {
            // 按钮点击：按当前状态推进
            if (this.loopA === null) {
                this.toggleABLoop('setA');
            } else if (this.loopB === null) {
                this.toggleABLoop('setB');
            } else {
                this.toggleABLoop('clear');
            }
        }
    },

    // 复读循环检查（timeupdate 中调用）
    checkABLoop() {
        if (this.loopA !== null && this.loopB !== null && this.audio) {
            if (this.audio.currentTime >= this.loopB) {
                this.audio.currentTime = this.loopA;
            }
        }
    },

    // 进度条上的 A-B 区间高亮
    updateABRegion() {
        const region = document.getElementById('ab-region');
        const btn = document.getElementById('ab-btn');
        if (!region || !this.audio || !this.audio.duration) return;

        if (this.loopA === null) {
            region.style.display = 'none';
        } else {
            const aPct = (this.loopA / this.audio.duration) * 100;
            const bPct = this.loopB === null
                ? ((this.audio.currentTime / this.audio.duration) * 100)
                : (this.loopB / this.audio.duration) * 100;
            region.style.display = 'block';
            region.style.left = aPct + '%';
            region.style.width = Math.max(0.5, bPct - aPct) + '%';
        }

        if (btn) {
            btn.classList.remove('set-a', 'looping');
            if (this.loopA !== null && this.loopB !== null) {
                btn.classList.add('looping');
                btn.textContent = 'A-B';
            } else if (this.loopA !== null) {
                btn.classList.add('set-a');
                btn.textContent = 'A?';
            } else {
                btn.textContent = 'A-B';
            }
        }
    },

    // 切歌时清除复读区间
    clearABLoopOnSongChange() {
        if (this.loopA !== null || this.loopB !== null) {
            this.loopA = null;
            this.loopB = null;
            this.updateABRegion();
        }
    },

    // ==================== 睡眠定时 ====================

    showSleepTimerMenu(anchorBtn) {
        this.closePopoverMenu();

        const menu = document.createElement('div');
        menu.className = 'popover-menu';
        menu.id = 'popover-menu';

        const options = [
            { label: '关闭', value: 0 },
            { label: '15 分钟', value: 15 },
            { label: '30 分钟', value: 30 },
            { label: '60 分钟', value: 60 },
            { label: '90 分钟', value: 90 },
            { label: '播完当前停止', value: 'end' }
        ];

        const current = this.sleepTimerMinutes === undefined ? 0 : this.sleepTimerMinutes;

        options.forEach(opt => {
            const item = document.createElement('div');
            const isChecked = (opt.value === 'end' && this.stopAfterEnd) ||
                (opt.value !== 'end' && opt.value === current && !this.stopAfterEnd);
            item.className = 'menu-item' + (isChecked ? ' checked' : '');
            item.innerHTML = `<span>${opt.label}</span>${isChecked ? '<span>✓</span>' : ''}`;
            item.addEventListener('click', () => {
                this.setSleepTimer(opt.value);
                this.closePopoverMenu();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.positionPopover(menu, anchorBtn);
    },

    setSleepTimer(value) {
        // 清除已有定时
        if (this.sleepTimerId) {
            clearTimeout(this.sleepTimerId);
            this.sleepTimerId = null;
        }
        this.stopAfterEnd = false;

        const btn = document.getElementById('sleep-timer-btn');

        if (value === 0) {
            this.sleepTimerMinutes = 0;
            if (btn) {
                btn.classList.remove('sleep-active');
                btn.title = '睡眠定时';
            }
            this.showMessage('睡眠定时已关闭', 'info');
            return;
        }

        if (value === 'end') {
            this.stopAfterEnd = true;
            if (btn) {
                btn.classList.add('sleep-active');
                btn.title = '睡眠定时：播完当前停止';
            }
            this.showMessage('将在播完当前内容后停止', 'info');
            return;
        }

        // 分钟定时
        this.sleepTimerMinutes = value;
        this.sleepTimerId = setTimeout(() => {
            if (this.audio && !this.audio.paused) {
                this.audio.pause();
            }
            this.setSleepTimer(0);
            this.showMessage('睡眠定时到了，已停止播放 🌙', 'info');
        }, value * 60 * 1000);

        if (btn) {
            btn.classList.add('sleep-active');
            btn.title = `睡眠定时：${value} 分钟后停止`;
        }
        this.showMessage(`睡眠定时：${value} 分钟后停止`, 'success');
    },

    // ==================== 随机播放队列 ====================

    // 重建随机队列（当前曲目开头，其余 Fisher-Yates 洗牌）
    rebuildShuffleQueue() {
        const len = this.playlist.length;
        this.shuffleOrder = Array.from({ length: len }, (_, i) => i);

        // 把当前曲目换到首位
        if (this.currentIndex > 0 && this.currentIndex < len) {
            [this.shuffleOrder[0], this.shuffleOrder[this.currentIndex]] = [this.shuffleOrder[this.currentIndex], this.shuffleOrder[0]];
        }

        // 洗牌其余部分
        for (let i = len - 1; i > 1; i--) {
            const j = 1 + Math.floor(Math.random() * i);
            [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
        }

        this.shufflePosition = len > 0 ? 0 : -1;
    },

    // 同步队列位置（playSong 后调用）
    syncShufflePosition() {
        if (this.playMode !== 'shuffle' || !this.shuffleOrder) return;
        const pos = this.shuffleOrder.indexOf(this.currentIndex);
        if (pos !== -1) {
            this.shufflePosition = pos;
        }
    },

    // ==================== 进度条拖拽 ====================

    setupProgressDrag() {
        const container = document.getElementById('progress-bar-container');
        const tooltip = document.getElementById('progress-tooltip');
        const filled = document.getElementById('progress-filled');
        const handle = document.getElementById('progress-handle');
        if (!container) return;

        const getPercent = (e) => {
            const rect = container.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        };

        const updateVisual = (percent) => {
            if (filled) filled.style.width = percent * 100 + '%';
            if (handle) handle.style.left = percent * 100 + '%';
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = percent * 100 + '%';
                if (this.audio && this.audio.duration) {
                    tooltip.textContent = utils.formatTime(percent * this.audio.duration);
                }
            }
        };

        container.addEventListener('pointerdown', (e) => {
            if (!this.audio || !this.audio.duration) return;
            e.preventDefault();
            container.setPointerCapture(e.pointerId);
            container.classList.add('dragging');
            this.progressDragging = true;
            updateVisual(getPercent(e));
        });

        container.addEventListener('pointermove', (e) => {
            if (!this.progressDragging) return;
            updateVisual(getPercent(e));
        });

        const finishDrag = (e) => {
            if (!this.progressDragging) return;
            this.progressDragging = false;
            container.classList.remove('dragging');
            if (tooltip) tooltip.style.display = 'none';
            if (this.audio && this.audio.duration) {
                this.audio.currentTime = getPercent(e) * this.audio.duration;
            }
        };

        container.addEventListener('pointerup', finishDrag);
        container.addEventListener('pointercancel', finishDrag);
        container.addEventListener('lostpointercapture', () => {
            if (this.progressDragging) {
                this.progressDragging = false;
                container.classList.remove('dragging');
                if (tooltip) tooltip.style.display = 'none';
            }
        });
    },

    // ==================== 弹出菜单定位与清理 ====================

    positionPopover(menu, anchorBtn) {
        if (!anchorBtn) return;
        const rect = anchorBtn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();

        let x = rect.left + rect.width / 2 - menuRect.width / 2;
        let y = rect.bottom + 6;

        // 防止超出窗口
        if (x + menuRect.width > window.innerWidth - 8) {
            x = window.innerWidth - menuRect.width - 8;
        }
        if (x < 8) x = 8;
        if (y + menuRect.height > window.innerHeight - 8) {
            y = rect.top - menuRect.height - 6;
        }

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    },

    closePopoverMenu() {
        const existing = document.getElementById('popover-menu');
        if (existing) existing.remove();
    },

    // ==================== 快进快退 ====================

    seekBy(seconds) {
        if (!this.audio || !this.audio.duration) return;
        this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
    }
};
