// 歌词功能（mixin：挂载到 MusicPlayer.prototype）
// 包含：歌词加载/桌面歌词同步、AI 音频转歌词（whisper）、图片 OCR 导入、歌词编辑
window.LyricsUI = {
    async loadLyrics(songTitle) {
        try {
            const result = await electronAPI.lyrics.get(songTitle);
            // 主进程返回 {success, lyrics: [{time, text}]}，校验为数组再使用
            this.currentLyrics = (result && result.success && Array.isArray(result.lyrics)) ? result.lyrics : null;
            this.plainLyricsShown = null;
        } catch (error) {
            logger.error('加载歌词失败:', error);
            this.currentLyrics = null;
        }
    },

    startLyricsSync() {
        if (this.lyricsInterval) {
            clearInterval(this.lyricsInterval);
        }

        this.lyricsInterval = setInterval(() => {
            this.updateLyrics();
        }, 100);
    },

    stopLyricsSync() {
        if (this.lyricsInterval) {
            clearInterval(this.lyricsInterval);
            this.lyricsInterval = null;
        }
    },

    updateLyrics() {
        if (!this.currentLyrics || !Array.isArray(this.currentLyrics) || this.currentLyrics.length === 0 || !this.audio) return;

        // 纯文本歌词（OCR 导入等，无时间轴）：桌面歌词固定显示第一行
        if (this.currentLyrics[0].time === null) {
            if (this.plainLyricsShown !== this.currentLyrics) {
                this.plainLyricsShown = this.currentLyrics;
                electronAPI.lyrics.updateWindow(this.currentLyrics[0].text);
            }
            return;
        }

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
    },

    toggleLyricsWindow() {
        electronAPI.lyrics.toggleWindow();
    },

    // ==================== AI 音频转歌词（whisper） ====================

    // 入口：检查模型 → 转写 → 编辑保存
    async transcribeSong(song) {
        let status;
        try {
            status = await electronAPI.whisper.getStatus();
        } catch (error) {
            logger.error('获取语音识别状态失败:', error);
            this.showMessage('语音识别服务不可用', 'error');
            return;
        }

        if (!status.success) {
            this.showMessage(status.error || '语音识别服务不可用', 'error');
            return;
        }

        // 当前模型未下载 → 先让用户选择并下载
        const current = status.currentModel || 'base';
        if (!status.models || !status.models[current] || !status.models[current].downloaded) {
            const ready = await this.showWhisperModelManager(true);
            if (!ready) {
                this.showMessage('需要先下载语音识别模型', 'info');
                return;
            }
        }

        // 转写进度对话框
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content" style="width: 460px;">
                <div class="modal-header">
                    <h3>AI 识别歌词</h3>
                </div>
                <div class="modal-body">
                    <p style="font-size: 13px; color: var(--text); margin-bottom: 10px;" id="transcribe-song-name">${utils.escapeHtml(song.title)}</p>
                    <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 14px;" id="transcribe-status-text">正在准备...</p>
                    <div class="progress-bar-container" style="height: 8px;">
                        <div class="progress-bar">
                            <div class="progress-filled" id="transcribe-progress-bar" style="width: 0%"></div>
                        </div>
                    </div>
                    <p style="font-size: 11.5px; color: var(--text-faint); margin-top: 8px;">自动检测语言（中/英/日等），耗时取决于音频长度与模型规格</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="transcribe-cancel-btn">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        const statusText = dialog.querySelector('#transcribe-status-text');
        const progressBar = dialog.querySelector('#transcribe-progress-bar');

        const unsubStatus = electronAPI.whisper.onTranscribeStatus((text) => {
            if (statusText) statusText.textContent = text;
        });

        // whisper 的 stdout 进度（progress = XX%）
        const unsubProgress = electronAPI.download.onProgress((data) => {
            if (data.type === 'stdout' && progressBar) {
                const match = data.data.match(/progress =\s*(\d+)%/);
                if (match) {
                    progressBar.style.width = match[1] + '%';
                }
            }
        });

        dialog.querySelector('#transcribe-cancel-btn').addEventListener('click', async () => {
            try { await electronAPI.download.cancel(); } catch (e) { /* 忽略 */ }
        });

        let result = null;
        try {
            result = await electronAPI.whisper.transcribeSong(song.id);
        } catch (error) {
            logger.error('音频转写失败:', error);
        } finally {
            unsubStatus();
            unsubProgress();
            dialog.remove();
        }

        if (!result) {
            this.showMessage('识别失败，请重试', 'error');
            return;
        }

        // 模型缺失（可能被删除）→ 引导下载
        if (result.modelMissing) {
            const ready = await this.showWhisperModelManager(true);
            if (ready) {
                await this.transcribeSong(song);
            }
            return;
        }

        if (result.cancelled) {
            this.showMessage('已取消识别', 'info');
            return;
        }

        if (!result.success) {
            this.showMessage(result.error || '识别失败', 'error');
            return;
        }

        // 编辑确认
        const saved = await this.showLyricsEditDialog(song, result.lrc, '识别结果（可编辑）');
        if (saved) {
            this.showMessage('歌词已保存', 'success');
        }
    },

    // ==================== 批量 AI 转写（已有内容，无需重新下载） ====================

    // 对所有没有歌词的已有内容批量转写
    async batchTranscribe() {
        // 模型检查
        let status;
        try {
            status = await electronAPI.whisper.getStatus();
        } catch (error) {
            this.showMessage('语音识别服务不可用', 'error');
            return;
        }
        if (!status.success) {
            this.showMessage(status.error || '语音识别服务不可用', 'error');
            return;
        }

        const current = status.currentModel || 'base';
        if (!status.models || !status.models[current] || !status.models[current].downloaded) {
            const ready = await this.showWhisperModelManager(true);
            if (!ready) {
                this.showMessage('需要先下载语音识别模型', 'info');
                return;
            }
        }

        // 获取缺歌词清单
        let missing;
        try {
            missing = await electronAPI.lyrics.getMissing();
        } catch (error) {
            this.showMessage('查询失败: ' + error.message, 'error');
            return;
        }
        if (!missing.success) {
            this.showMessage(missing.error || '查询失败', 'error');
            return;
        }
        if (!missing.songs || missing.songs.length === 0) {
            this.showMessage('所有内容都已有歌词，无需识别', 'info');
            return;
        }

        const total = missing.songs.length;
        let done = 0, successCount = 0, failCount = 0, cancelled = false;

        // 进度对话框
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content" style="width: 460px;">
                <div class="modal-header">
                    <h3>批量 AI 识别歌词</h3>
                </div>
                <div class="modal-body">
                    <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 6px;" id="batch-transcribe-count"></p>
                    <p style="font-size: 12.5px; color: var(--text); margin-bottom: 12px;" id="batch-transcribe-name">准备中...</p>
                    <div class="progress-bar-container" style="height: 8px;">
                        <div class="progress-bar">
                            <div class="progress-filled" id="batch-transcribe-bar" style="width: 0%"></div>
                        </div>
                    </div>
                    <p style="font-size: 11.5px; color: var(--text-faint); margin-top: 10px;">对已有音频本地识别（不用重新下载），耗时取决于数量与模型规格。识别结果自动保存为歌词。</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="batch-transcribe-cancel">停止</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        const countEl = dialog.querySelector('#batch-transcribe-count');
        const nameEl = dialog.querySelector('#batch-transcribe-name');
        const barEl = dialog.querySelector('#batch-transcribe-bar');

        const updateProgress = () => {
            if (countEl) countEl.textContent = `进度：${done} / ${total}（成功 ${successCount}，失败 ${failCount}）`;
            if (barEl) barEl.style.width = (total ? (done / total) * 100 : 100).toFixed(1) + '%';
        };
        updateProgress();

        dialog.querySelector('#batch-transcribe-cancel').addEventListener('click', async () => {
            cancelled = true;
            try { await electronAPI.download.cancel(); } catch (e) { /* 忽略 */ }
        });

        for (const song of missing.songs) {
            if (cancelled) break;
            if (nameEl) nameEl.textContent = song.title;

            try {
                const result = await electronAPI.whisper.transcribeSong(song.id);
                if (result && result.success && result.lrc) {
                    await electronAPI.lyrics.save(song.title, result.lrc);
                    successCount++;
                } else if (result && result.cancelled) {
                    cancelled = true;
                    break;
                } else {
                    failCount++;
                }
            } catch (error) {
                failCount++;
            }

            done++;
            updateProgress();
        }

        dialog.remove();
        this.showMessage(cancelled
            ? `已停止：完成 ${successCount} 首，失败 ${failCount} 首`
            : `批量识别完成：成功 ${successCount} 首${failCount ? `，失败 ${failCount} 首` : ''}`,
            cancelled ? 'info' : 'success');
    },

    // ==================== whisper 模型管理（用户选择规格下载） ====================

    // autoCloseOnReady: 下载完成并设为当前模型后自动关闭（从转写流程进入时用）
    showWhisperModelManager(autoCloseOnReady = false) {
        return new Promise(async (resolve) => {
            let status;
            try {
                status = await electronAPI.whisper.getStatus();
            } catch (error) {
                this.showMessage('语音识别服务不可用', 'error');
                resolve(false);
                return;
            }

            if (!status.success) {
                this.showMessage(status.error || '语音识别服务不可用', 'error');
                resolve(false);
                return;
            }

            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content" style="width: 520px;">
                    <div class="modal-header">
                        <h3>语音识别模型</h3>
                        <button class="close-btn" aria-label="关闭">×</button>
                    </div>
                    <div class="modal-body">
                        <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.6;">
                            音频转歌词使用本地 AI 模型（whisper）识别，<strong>支持中文、英语、日语、俄语、法语、德语等 99 种语言自动检测</strong>，无需手动选择语言。
                        </p>
                        <p style="font-size: 11.5px; color: var(--text-faint); margin-bottom: 14px; line-height: 1.6;">
                            模型文件较大，<strong>按需选择下载</strong>（默认推荐 Base），随时可删除释放空间。<br>
                            下载来源：hf-mirror.com / huggingface.co（自动切换），保存到用户数据目录 models 文件夹。
                        </p>
                        <div id="model-list"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="model-manager-close-btn">${autoCloseOnReady ? '暂不使用' : '关闭'}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                dialog.remove();
                resolve(value);
            };

            dialog.querySelector('.close-btn').addEventListener('click', () => finish(false));
            dialog.querySelector('#model-manager-close-btn').addEventListener('click', () => finish(false));

            const modelList = dialog.querySelector('#model-list');

            const renderList = async () => {
                const fresh = await electronAPI.whisper.getStatus();
                if (!fresh.success) return;
                const current = fresh.currentModel;
                modelList.innerHTML = '';

                for (const model of Object.values(fresh.models)) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:11px 12px; border:1px solid var(--border); border-radius:9px; margin-bottom:8px;';

                    const isCurrent = model.key === current && model.downloaded;
                    row.innerHTML = `
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13px; font-weight:600; color:var(--text); display:flex; align-items:center; gap:7px;">
                                ${model.label}
                                ${model.recommended ? '<span style="font-size:10px; font-weight:700; color:var(--accent); background:var(--accent-soft); padding:1px 7px; border-radius:8px;">推荐</span>' : ''}
                            </div>
                            <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">${model.desc || ''} · ${model.sizeText}${model.downloaded ? ` · 已下载 ${utils.formatFileSize(model.sizeBytes)}` : ''}</div>
                            <div class="model-progress-wrap" style="display:none; margin-top:6px;">
                                <div class="progress-bar-container" style="height:5px;">
                                    <div class="progress-bar"><div class="progress-filled model-progress-bar" style="width:0%"></div></div>
                                </div>
                                <div class="model-progress-text" style="font-size:11px; color:var(--text-muted); margin-top:3px;">准备下载...</div>
                            </div>
                        </div>
                        <div class="model-actions" style="display:flex; gap:6px; flex-shrink:0;"></div>
                    `;

                    const actions = row.querySelector('.model-actions');

                    if (isCurrent) {
                        actions.innerHTML = '<span style="font-size:12px; font-weight:700; color:var(--accent);">使用中</span>';
                        const delBtn = document.createElement('button');
                        delBtn.className = 'btn btn-secondary';
                        delBtn.style.cssText = 'padding:5px 10px; font-size:12px;';
                        delBtn.textContent = '删除';
                        delBtn.addEventListener('click', async () => {
                            const confirmed = await this.showConfirm({
                                title: '删除模型',
                                message: `确定删除 ${model.label} 吗？下次使用需重新下载。`,
                                confirmText: '删除',
                                danger: true
                            });
                            if (confirmed) {
                                await electronAPI.whisper.deleteModel(model.key);
                                this.showMessage('模型已删除', 'success');
                                renderList();
                            }
                        });
                        actions.appendChild(delBtn);
                    } else if (model.downloaded) {
                        const useBtn = document.createElement('button');
                        useBtn.className = 'btn btn-primary';
                        useBtn.style.cssText = 'padding:5px 12px; font-size:12px;';
                        useBtn.textContent = '使用';
                        useBtn.addEventListener('click', async () => {
                            await electronAPI.whisper.setModel(model.key);
                            this.showMessage(`已切换为 ${model.label}`, 'success');
                            renderList();
                            if (autoCloseOnReady) finish(true);
                        });
                        actions.appendChild(useBtn);
                    } else {
                        const dlBtn = document.createElement('button');
                        dlBtn.className = 'btn btn-primary';
                        dlBtn.style.cssText = 'padding:5px 12px; font-size:12px;';
                        dlBtn.textContent = '下载';
                        dlBtn.addEventListener('click', async () => {
                            dlBtn.disabled = true;
                            const wrap = row.querySelector('.model-progress-wrap');
                            const bar = row.querySelector('.model-progress-bar');
                            const text = row.querySelector('.model-progress-text');
                            wrap.style.display = 'block';

                            const unsub = electronAPI.whisper.onModelProgress((data) => {
                                if (data.modelKey !== model.key) return;
                                if (bar && data.progress !== undefined) {
                                    bar.style.width = data.progress.toFixed(1) + '%';
                                }
                                if (text) {
                                    text.textContent = `${data.progress.toFixed(1)}%（${utils.formatFileSize(data.downloaded)} / ${utils.formatFileSize(data.total)}）`;
                                }
                            });

                            try {
                                const result = await electronAPI.whisper.downloadModel(model.key);
                                unsub();
                                if (result.success) {
                                    await electronAPI.whisper.setModel(model.key);
                                    this.showMessage(`${model.label} 下载完成`, 'success');
                                    if (autoCloseOnReady) {
                                        finish(true);
                                        return;
                                    }
                                    renderList();
                                } else {
                                    unsub();
                                    this.showMessage(result.error || '下载失败', 'error');
                                    wrap.style.display = 'none';
                                    dlBtn.disabled = false;
                                }
                            } catch (error) {
                                unsub();
                                this.showMessage('下载失败: ' + error.message, 'error');
                                wrap.style.display = 'none';
                                dlBtn.disabled = false;
                            }
                        });
                        actions.appendChild(dlBtn);
                    }

                    modelList.appendChild(row);
                }
            };

            await renderList();
        });
    },

    // ==================== 歌词编辑（AI 识别结果 / 手动编辑） ====================

    // 返回 Promise<boolean>：是否已保存
    showLyricsEditDialog(song, initialText, title = '编辑歌词') {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content" style="width: 560px;">
                    <div class="modal-header">
                        <h3>${utils.escapeHtml(title)}</h3>
                        <button class="close-btn" aria-label="关闭">×</button>
                    </div>
                    <div class="modal-body">
                        <p style="font-size: 12px; color: var(--text-faint); margin-bottom: 10px;">
                            可直接编辑；带时间标签 [mm:ss.xx] 的行会逐句同步显示，无标签按纯文本保存
                        </p>
                        <textarea id="lyrics-edit-text" class="lyrics-textarea">${utils.escapeHtml(initialText || '')}</textarea>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" data-role="cancel">取消</button>
                        <button class="btn btn-primary" id="save-lyrics-edit-btn">保存</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            const textarea = dialog.querySelector('#lyrics-edit-text');
            textarea.focus();

            const finish = (saved) => {
                dialog.remove();
                resolve(saved);
            };

            dialog.querySelector('.close-btn').addEventListener('click', () => finish(false));
            dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => finish(false));

            dialog.querySelector('#save-lyrics-edit-btn').addEventListener('click', async () => {
                const text = textarea.value.trim();
                if (!text) {
                    this.showMessage('内容为空', 'warning');
                    return;
                }
                try {
                    await electronAPI.lyrics.save(song.title, text);
                    // 若正在播放这首歌，重新加载歌词
                    if (this.currentSong && this.currentSong.id === song.id) {
                        await this.loadLyrics(song.title);
                    }
                    finish(true);
                } catch (error) {
                    logger.error('保存歌词失败:', error);
                    this.showMessage('保存失败: ' + error.message, 'error');
                }
            });
        });
    }
};
