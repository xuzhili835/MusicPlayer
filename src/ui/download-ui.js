// 后台任务系统与下载界面（mixin：挂载到 MusicPlayer.prototype）
// 统一管理多任务（下载 / AI识别 / 模型下载）：标题栏徽标显示总数，
// 点击展开任务面板：每个任务独立名称、状态文本、进度条、取消按钮
window.DownloadUI = {
    // ==================== 任务注册表（渲染端） ====================

    // key → { type: 'download'|'transcribe', name, status, percent, done, failed }
    // 渲染端状态由全局事件驱动（下载 stage/progress、识别 transcribe-status/progress）

    ensureTasks() {
        if (!this._bgTasks) this._bgTasks = new Map();
        return this._bgTasks;
    },

    showTask(key, type, name) {
        const tasks = this.ensureTasks();
        tasks.set(key, { type, name, status: '准备中...', percent: 0, done: false, failed: false });
        this.renderTasks();
    },

    updateTask(key, { status, percent } = {}) {
        const tasks = this.ensureTasks();
        const t = tasks.get(key);
        if (!t || t.done || t.failed) return;
        if (typeof status === 'string') t.status = status;
        if (typeof percent === 'number') t.percent = Math.max(0, Math.min(100, percent));
        this.renderTasks();
    },

    finishTask(key, { success = true, status = '' } = {}) {
        const tasks = this.ensureTasks();
        const t = tasks.get(key);
        if (!t) return;
        t.done = success;
        t.failed = !success;
        t.status = status || (success ? '已完成' : '失败');
        t.percent = success ? 100 : t.percent;
        this.renderTasks();
        // 完成的任务 4 秒后从面板移除
        setTimeout(() => { tasks.delete(key); this.renderTasks(); }, 4000);
    },

    removeTask(key) {
        this.ensureTasks().delete(key);
        this.renderTasks();
    },

    cancelTask(key) {
        // 当前两类任务的取消都走主进程统一取消（kill 子进程 + 清理临时文件）
        electronAPI.download.cancel().catch(() => {});
    },

    renderTasks() {
        const tasks = this.ensureTasks();

        // 徽标：进行中任务数
        const indicator = document.getElementById('download-indicator');
        const indicatorText = document.getElementById('download-indicator-text');
        const running = Array.from(tasks.values()).filter(t => !t.done && !t.failed).length;
        if (indicator) indicator.style.display = running > 0 ? 'flex' : 'none';
        if (indicatorText) indicatorText.textContent = `${running} 个任务`;

        // 面板列表（打开时才渲染内容）
        const list = document.getElementById('task-list');
        const panel = document.getElementById('task-panel');
        if (!list || !panel || panel.style.display === 'none') return;

        const countEl = document.getElementById('task-panel-count');
        if (countEl) countEl.textContent = String(tasks.size);

        list.innerHTML = '';
        if (tasks.size === 0) {
            list.innerHTML = '<div class="task-empty">没有进行中的任务</div>';
            return;
        }

        const typeIcon = { download: '⬇', transcribe: '♪' };

        for (const [key, t] of tasks) {
            const item = document.createElement('div');
            item.className = 'task-item' + (t.done ? ' done' : '') + (t.failed ? ' failed' : '');
            item.innerHTML = `
                <div class="task-item-row">
                    <div class="task-item-icon">${typeIcon[t.type] || '⚙'}</div>
                    <div class="task-item-name" title="${utils.escapeHtml(t.name)}">${utils.escapeHtml(t.name)}</div>
                    ${(!t.done && !t.failed) ? `<button class="task-item-cancel" data-key="${utils.escapeHtml(key)}" title="取消">×</button>` : ''}
                </div>
                <div class="task-item-status">${utils.escapeHtml(t.status)}${(!t.done && !t.failed && t.percent > 0) ? ` · ${t.percent}%` : ''}</div>
                ${(!t.done && !t.failed) ? `
                <div class="progress-bar-container" style="height: 4px;">
                    <div class="progress-bar"><div class="progress-filled" style="width: ${t.percent}%"></div></div>
                </div>` : ''}
            `;
            list.appendChild(item);
        }

        // 取消按钮（事件委托）
        list.querySelectorAll('.task-item-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelTask(btn.dataset.key);
            });
        });
    },

    toggleTaskPanel() {
        const panel = document.getElementById('task-panel');
        if (!panel) return;
        const willShow = panel.style.display === 'none';
        panel.style.display = willShow ? 'block' : 'none';
        if (willShow) this.renderTasks();
    },

    // 全局事件 → 任务系统（应用启动时调用一次）
    setupDownloadIndicatorListeners() {
        if (this._downloadIndicatorBound) return;
        this._downloadIndicatorBound = true;

        // 下载：阶段进度
        electronAPI.download.onStageProgress((data) => {
            this.updateTask('download', { status: `${data.stage}/${data.totalStages} ${data.description}` });
        });

        // 字幕下载由 lyrics.js 直接启动 yt-dlp，单独转发其实时百分比。
        electronAPI.download.onLyricsProgress((data) => {
            const progress = typeof data.progress === 'number' ? data.progress : 0;
            this.updateTask('download', {
                status: `4/5 ${data.status || '正在下载歌词...'}`,
                percent: progress
            });
        });

        // 下载 + 识别共用的 stdout 进度流
        electronAPI.download.onProgress((data) => {
            if (data.type !== 'stdout') return;
            const m = data.data.match(/progress =\s*(\d+)%/);          // whisper: progress = XX%
            const d = data.data.match(/\[download\]\s+(\d+\.?\d*)%/);  // yt-dlp: [download] xx.x%
            if (m) this.updateTask(this._lastTranscribeKey || 'download', { percent: parseInt(m[1], 10) });
            else if (d) this.updateTask('download', { percent: parseFloat(d[1]) });
        });

        // 识别：状态文本
        electronAPI.whisper.onTranscribeStatus((text) => {
            this.updateTask(this._lastTranscribeKey || 'download', { status: text });
        });
    },

    // ==================== 下载流程（后台任务模式） ====================

    showDownloadDialog() {
        const dialog = document.getElementById('download-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const urlInput = document.getElementById('download-url');
            if (urlInput) {
                urlInput.focus();
            }
            this.refreshModelStatus();
        }
    },

    // 「获取歌词」的本地识别依赖：打开对话框时提示模型状态，
    // 未安装可直接在这里下载（进任务面板显示进度）
    async refreshModelStatus() {
        const row = document.getElementById('download-model-status');
        const textEl = document.getElementById('download-model-status-text');
        const btn = document.getElementById('download-model-btn');
        if (!row || !textEl || !btn) return;
        try {
            const status = await electronAPI.whisper.getStatus();
            const models = (status && status.models) || {};
            const ready = Object.values(models).some(m => m && m.downloaded);
            if (ready) {
                row.style.display = 'block';
                textEl.textContent = '本地识别模型就绪 ✓';
                textEl.style.color = 'var(--text-secondary, #8a8f98)';
                btn.style.display = 'none';
            } else {
                row.style.display = 'block';
                textEl.textContent = '本地识别模型未安装（在线查不到歌词时无法本地识别）';
                textEl.style.color = 'var(--warning, #e6a700)';
                btn.style.display = 'inline-block';
            }
        } catch (e) {
            row.style.display = 'none';
        }
        if (this._modelBtnBound) return;
        this._modelBtnBound = true;
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            this.showTask('model', 'transcribe', '识别模型');
            this.updateTask('model', { status: '准备下载模型...' });
            try {
                await electronAPI.whisper.downloadModel('small');
                this.finishTask('model', { success: true, status: '模型下载完成' });
                this.showMessage('识别模型下载完成', 'success');
            } catch (err) {
                this.finishTask('model', { success: false, status: '模型下载失败' });
                this.showMessage('模型下载失败: ' + err.message, 'error');
            }
            btn.disabled = false;
            this.refreshModelStatus();
        });
        electronAPI.whisper.onModelProgress((data) => {
            const percent = typeof data.percent === 'number' ? data.percent : 0;
            this.updateTask('model', { status: '下载识别模型', percent });
        });
    },

    hideDownloadDialog() {
        const dialog = document.getElementById('download-dialog');
        if (dialog) {
            dialog.style.display = 'none';
            this.clearDownloadForm();
        }
    },

    clearDownloadForm() {
        const urlInput = document.getElementById('download-url');
        const preview = document.getElementById('video-preview');
        const progress = document.getElementById('download-progress');

        if (urlInput) urlInput.value = '';
        if (preview) preview.style.display = 'none';
        if (progress) progress.style.display = 'none';
    },

    // 取消下载（终止后台进程，不再"假取消"）
    async cancelDownload() {
        try {
            await electronAPI.download.cancel();
            this.showMessage('已取消下载', 'info');
        } catch (error) {
            logger.error('取消下载失败:', error);
        }
    },

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
    },

    async startDownload() {
        const urlInput = document.getElementById('download-url');

        if (!urlInput || !urlInput.value.trim()) {
            this.showMessage('请输入链接', 'warning');
            return;
        }

        const inputText = urlInput.value.trim();
        // 智能提取音源链接（B站 或 YouTube）
        const url = utils.extractMediaUrl(inputText);

        if (!url) {
            this.showMessage('未找到有效的链接（支持 Bilibili / YouTube）', 'warning');
            return;
        }

        // 读取下载选项（歌词获取已合并为单一开关：在线优先，无则本地识别）
        const optLyrics = document.getElementById('opt-download-lyrics');
        const options = {
            getLyrics: optLyrics ? optLyrics.checked : true
        };

        // 转后台：关闭对话框，任务进面板
        this.hideDownloadDialog();
        this.showTask('download', 'download', '音源下载');
        this.updateTask('download', { status: '准备下载...' });

        try {
            const result = await electronAPI.download.media(url, options);

            if (result.success) {
                this.finishTask('download', { success: true, status: '下载完成' });
                this.showMessage('下载完成', 'success');
                await this.refreshCurrentView();
                await this.loadPlaylistsToSidebar();
            }
        } catch (error) {
            logger.error('下载失败:', error);

            if (error.message && error.message.includes('取消')) {
                this.finishTask('download', { success: false, status: '已取消' });
                this.showMessage('已取消下载', 'info');
                return;
            }

            let message = error.message;
            if (error.message.includes('歌曲已存在于音乐库')) {
                message = '已存在于音乐库';
            }

            this.finishTask('download', { success: false, status: message.slice(0, 60) });
            this.showMessage(message, 'error');
        }
    },

    // 徽标点击 → 任务面板
    async cancelBackgroundDownload() {
        this.cancelTask('download');
    }
};
