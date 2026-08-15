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
        // 智能提取B站链接
        const url = utils.extractBilibiliUrl(inputText);

        if (!url) {
            this.showMessage('未找到有效的链接', 'warning');
            return;
        }

        try {
            this.showDownloadProgress();

            const result = await electronAPI.download.bilibiliVideo(url, {
                downloadLyrics: true
            });

            if (result.success) {
                this.showMessage('下载完成', 'success');
                this.hideDownloadDialog();
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
            }

            this.showMessage(message, 'error');
        } finally {
            this.hideDownloadProgress();
        }
    },

    showDownloadProgress() {
        const progress = document.getElementById('download-progress');
        const startBtn = document.getElementById('download-start-btn');
        const status = document.getElementById('download-status');

        if (progress) progress.style.display = 'block';
        if (startBtn) startBtn.disabled = true;

        if (status) status.textContent = '准备下载...';

        const stageBadge = document.getElementById('download-stage');
        if (stageBadge) stageBadge.style.display = 'none';

        this.downloadProgressUnsubscribe = electronAPI.download.onProgress((data) => {
            this.updateDownloadProgress(data);
        });

        this.stageProgressUnsubscribe = electronAPI.download.onStageProgress((data) => {
            this.updateStageProgress(data);
        });
    },

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
    },

    updateDownloadProgress(data) {
        const status = document.getElementById('download-status');

        if (data.type === 'stdout') {
            const output = data.data;

            if (output.includes('[download] Destination:')) {
                if (status) status.textContent = '正在下载文件...';
            } else if (output.includes('[ffmpeg]') || output.includes('Post-process')) {
                if (status) status.textContent = '正在转换格式...';
            } else if (output.includes('Deleting original file')) {
                if (status) status.textContent = '正在清理临时文件...';
            }
        }
    },

    updateStageProgress(data) {
        this.currentDownloadStage = data.stage;
        this.totalDownloadStages = data.totalStages;

        const status = document.getElementById('download-status');
        const stageBadge = document.getElementById('download-stage');

        if (status) {
            status.textContent = `${data.description}`;
        }

        if (stageBadge) {
            stageBadge.textContent = `${data.stage}/${data.totalStages}`;
            stageBadge.style.display = 'inline-flex';
        }
    }
};
