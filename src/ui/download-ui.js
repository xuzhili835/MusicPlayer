// 下载对话框与进度（mixin：挂载到 MusicPlayer.prototype）
window.DownloadUI = {
    showDownloadDialog() {
        const dialog = document.getElementById('download-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const urlInput = document.getElementById('download-url');
            if (urlInput) {
                urlInput.focus();
            }
        }
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
        } finally {
            this.hideDownloadDialog();
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

        // 读取下载选项
        const optLyrics = document.getElementById('opt-download-lyrics');
        const optTranscribe = document.getElementById('opt-auto-transcribe');
        const options = {
            downloadLyrics: optLyrics ? optLyrics.checked : true,
            autoTranscribe: optTranscribe ? optTranscribe.checked : false
        };

        // 转后台：关闭对话框，进度显示在标题栏徽标
        this.hideDownloadDialog();
        this.showDownloadIndicator(options.autoTranscribe ? '准备下载（含 AI 转写）...' : '准备下载...');

        try {
            const result = await electronAPI.download.media(url, options);

            if (result.success) {
                this.showMessage('下载完成', 'success');
                await this.refreshCurrentView();
                await this.loadPlaylistsToSidebar();
            }
        } catch (error) {
            logger.error('下载失败:', error);

            // 用户主动取消：静默处理
            if (error.message && error.message.includes('取消')) {
                this.showMessage('已取消下载', 'info');
                return;
            }

            let message = error.message;
            if (error.message.includes('歌曲已存在于音乐库')) {
                message = '已存在于音乐库';
            } else if (error.message.includes('已有下载任务')) {
                message = error.message;
            }

            this.showMessage(message, 'error');
        } finally {
            this.hideDownloadIndicator();
        }
    },

    // ---------- 后台下载徽标 ----------

    showDownloadIndicator(text) {
        const indicator = document.getElementById('download-indicator');
        const textEl = document.getElementById('download-indicator-text');
        if (textEl) textEl.textContent = text || '下载中';
        if (indicator) indicator.style.display = 'flex';
    },

    updateDownloadIndicator(text) {
        const textEl = document.getElementById('download-indicator-text');
        if (textEl && text) textEl.textContent = text;
    },

    hideDownloadIndicator() {
        const indicator = document.getElementById('download-indicator');
        if (indicator) indicator.style.display = 'none';
    },

    // 全局下载进度订阅（后台徽标，应用启动时调用一次）
    setupDownloadIndicatorListeners() {
        if (this._downloadIndicatorBound) return;
        this._downloadIndicatorBound = true;

        electronAPI.download.onStageProgress((data) => {
            this.updateDownloadIndicator(`${data.stage}/${data.totalStages} ${data.description}`);
        });

        electronAPI.download.onProgress((data) => {
            if (data.type !== 'stdout') return;
            // 转写进度（progress = XX%）也走这里
            const match = data.data.match(/progress =\s*(\d+)%/);
            if (match) {
                this.updateDownloadIndicator(`AI 识别中 ${match[1]}%`);
            }
        });
    },

    // 徽标上的取消按钮
    async cancelBackgroundDownload() {
        try {
            await electronAPI.download.cancel();
        } catch (error) {
            logger.error('取消下载失败:', error);
        }
    }
};
