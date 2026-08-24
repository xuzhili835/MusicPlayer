// 对话框（mixin：挂载到 MusicPlayer.prototype）
// 包含：修改信息 / 详细信息 / 设置 / 批量音量同步 / 删除
window.DialogsUI = {
    // ---------- 修改信息 ----------

    async showEditSongInfoDialog(song) {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>修改信息</h3>
                    <button class="close-btn" aria-label="关闭">×</button>
                </div>
                <div class="modal-body">
                    <div class="edit-song-form">
                        <div class="form-group">
                            <label for="edit-song-title">标题</label>
                            <input type="text" id="edit-song-title" value="${utils.escapeHtml(song.title || '')}" placeholder="请输入标题">
                        </div>
                        <div class="form-group">
                            <label for="edit-song-artist">艺术家</label>
                            <input type="text" id="edit-song-artist" value="${utils.escapeHtml(song.artist || '')}" placeholder="请输入艺术家名称">
                        </div>
                        <div class="form-info">
                            <p><strong>文件路径:</strong> ${utils.escapeHtml(song.path)}</p>
                            <p><strong>时长:</strong> ${utils.formatTime(song.duration || 0)}</p>
                        </div>
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <button class="btn btn-secondary" id="edit-show-in-explorer-btn" style="padding:5px 12px; font-size:12px;">在文件夹中显示</button>
                            <button class="btn btn-secondary" id="edit-analyze-volume-btn" style="padding:5px 12px; font-size:12px;">同步音量</button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-role="cancel">取消</button>
                    <button class="btn btn-primary" id="save-song-info-btn">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const closeDialog = () => dialog.remove();
        dialog.querySelector('.close-btn').addEventListener('click', closeDialog);
        dialog.querySelector('[data-role="cancel"]').addEventListener('click', closeDialog);

        const titleInput = dialog.querySelector('#edit-song-title');
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }

        // 低频操作入口（从右键菜单精简挪入）
        const showInExplorerBtn = dialog.querySelector('#edit-show-in-explorer-btn');
        if (showInExplorerBtn) {
            showInExplorerBtn.addEventListener('click', async () => {
                try { await electronAPI.file.showInExplorer(song.path); } catch (e) { logger.error('打开文件夹失败:', e); }
            });
        }
        const analyzeVolumeBtn = dialog.querySelector('#edit-analyze-volume-btn');
        if (analyzeVolumeBtn) {
            analyzeVolumeBtn.addEventListener('click', async () => {
                analyzeVolumeBtn.disabled = true;
                try { await this.analyzeSongVolume(song.id); } finally { analyzeVolumeBtn.disabled = false; }
            });
        }

        const saveBtn = dialog.querySelector('#save-song-info-btn');
        saveBtn.addEventListener('click', async () => {
            const title = dialog.querySelector('#edit-song-title').value.trim();
            const artist = dialog.querySelector('#edit-song-artist').value.trim();

            if (!title) {
                this.showMessage('请输入标题', 'error');
                return;
            }

            try {
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
                const allIndex = (this.allSongs || []).findIndex(s => s.id === song.id);
                if (allIndex !== -1) {
                    this.allSongs[allIndex].title = title;
                    this.allSongs[allIndex].artist = artist;
                }

                this.renderSongsList();

                // 如果当前播放的是这条内容，更新播放器显示
                if (this.currentSong && this.currentSong.id === song.id) {
                    this.currentSong.title = title;
                    this.currentSong.artist = artist;
                    this.updateCurrentSongInfo();
                }

                this.showMessage('信息已更新', 'success');
                dialog.remove();

            } catch (error) {
                logger.error('更新信息失败:', error);
                this.showMessage('更新失败', 'error');
            }
        });

        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveBtn.click();
            } else if (e.key === 'Escape') {
                dialog.remove();
            }
        });
    },

    // ---------- 详细信息 ----------

    showSongInfo(song) {
        const hasVolumeGain = song.volume_gain !== null && song.volume_gain !== undefined;

        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>详细信息</h3>
                    <button class="close-btn" aria-label="关闭">×</button>
                </div>
                <div class="modal-body">
                    <div class="song-info">
                        <div class="info-item">
                            <label>标题</label>
                            <span>${utils.escapeHtml(song.title)}</span>
                        </div>
                        <div class="info-item">
                            <label>艺术家</label>
                            <span>${utils.escapeHtml(song.artist || '未知')}</span>
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
                            <span>${utils.escapeHtml(song.path)}</span>
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
                    <button class="btn btn-secondary" data-role="close">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const close = () => dialog.remove();
        dialog.querySelector('.close-btn').addEventListener('click', close);
        dialog.querySelector('[data-role="close"]').addEventListener('click', close);
    },

    // ---------- 删除 ----------

    async deleteSong(songId) {
        const confirmed = await this.showConfirm({
            title: '删除内容',
            message: '确定要删除吗？这将永久删除音频文件和数据库记录，无法恢复。',
            confirmText: '删除',
            danger: true
        });

        if (!confirmed) return;

        try {
            // 如果删除的是当前播放的内容，先停止播放并释放文件句柄
            if (this.currentSong && this.currentSong.id === songId) {
                this.audio.pause();
                this.audio.src = '';
                this.audio.load();
                this.currentSong = null;
                this.currentIndex = -1;
                this.updateCurrentSongInfo();
            }

            // 主进程完整删除：音频文件+缩略图+歌词+数据库记录
            const result = await electronAPI.database.removeSong(songId);

            if (result && result.success) {
                this.showMessage('删除成功', 'success');
            } else {
                this.showMessage('删除失败: ' + ((result && result.error) || '未知错误'), 'error');
                return;
            }

            // 刷新当前视图（保持所在视图）+ 更新分类计数与歌单
            await this.refreshCurrentView();
            await this.loadPlaylistsToSidebar();

        } catch (error) {
            logger.error('删除失败:', error);
            this.showMessage('删除失败: ' + error.message, 'error');
        }
    },

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
    },

    // ---------- 设置 ----------

    async renderWhisperModelsInSettings(container) {
        if (!container) return;

        const refresh = async () => {
            container.innerHTML = '<small style="color: var(--text-faint);">正在读取模型状态...</small>';
            let status;
            try {
                status = await electronAPI.whisper.getStatus();
            } catch (error) {
                container.innerHTML = '<small style="color: var(--warning);">语音识别服务不可用</small>';
                return;
            }
            if (!status || !status.success) {
                container.innerHTML = `<small style="color: var(--warning);">${utils.escapeHtml((status && status.error) || '读取模型状态失败')}</small>`;
                return;
            }

            container.innerHTML = '';
            for (const model of Object.values(status.models || {})) {
                const isCurrent = model.key === status.currentModel && model.downloaded;
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 11px; border:1px solid var(--border); border-radius:8px; margin-bottom:7px;';
                row.innerHTML = `
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:600; color:var(--text); display:flex; align-items:center; gap:7px;">
                            ${utils.escapeHtml(model.label)}
                            ${model.recommended ? '<span style="font-size:10px; font-weight:700; color:var(--accent); background:var(--accent-soft); padding:1px 7px; border-radius:8px;">推荐</span>' : ''}
                        </div>
                        <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">${utils.escapeHtml(model.desc || '')} · ${utils.escapeHtml(model.sizeText || '')}${model.downloaded ? ` · 已下载 ${utils.formatFileSize(model.sizeBytes)}` : ''}</div>
                        <div class="settings-model-progress" style="display:none; margin-top:6px;">
                            <div class="progress-bar-container" style="height:5px;"><div class="progress-bar"><div class="progress-filled" style="width:0%"></div></div></div>
                            <div class="settings-model-progress-text" style="font-size:11px; color:var(--text-muted); margin-top:3px;">准备下载...</div>
                        </div>
                    </div>
                    <div class="settings-model-actions" style="display:flex; gap:6px; flex-shrink:0;"></div>
                `;
                const actions = row.querySelector('.settings-model-actions');

                if (isCurrent) {
                    actions.innerHTML = '<span style="font-size:12px; font-weight:700; color:var(--accent);">使用中</span>';
                } else if (model.downloaded) {
                    const useBtn = document.createElement('button');
                    useBtn.className = 'btn btn-primary';
                    useBtn.style.cssText = 'padding:5px 10px; font-size:12px;';
                    useBtn.textContent = '使用';
                    useBtn.addEventListener('click', async () => {
                        const result = await electronAPI.whisper.setModel(model.key);
                        if (result && result.success) {
                            this.showMessage(`已切换为 ${model.label}`, 'success');
                            refresh();
                        } else {
                            this.showMessage((result && result.error) || '切换模型失败', 'error');
                        }
                    });

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn btn-secondary';
                    deleteBtn.style.cssText = 'padding:5px 10px; font-size:12px;';
                    deleteBtn.textContent = '删除';
                    deleteBtn.addEventListener('click', async () => {
                        const confirmed = await this.showConfirm({
                            title: '删除模型',
                            message: `确定删除 ${model.label} 吗？下次使用需重新下载。`,
                            confirmText: '删除',
                            danger: true
                        });
                        if (!confirmed) return;
                        const result = await electronAPI.whisper.deleteModel(model.key);
                        if (result && result.success) {
                            this.showMessage('模型已删除', 'success');
                            refresh();
                        } else {
                            this.showMessage((result && result.error) || '删除模型失败', 'error');
                        }
                    });
                    actions.append(useBtn, deleteBtn);
                } else {
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'btn btn-primary';
                    downloadBtn.style.cssText = 'padding:5px 10px; font-size:12px;';
                    downloadBtn.textContent = '下载';
                    downloadBtn.addEventListener('click', async () => {
                        downloadBtn.disabled = true;
                        const progressWrap = row.querySelector('.settings-model-progress');
                        const progressBar = progressWrap.querySelector('.progress-filled');
                        const progressText = row.querySelector('.settings-model-progress-text');
                        progressWrap.style.display = 'block';
                        const unsub = electronAPI.whisper.onModelProgress((data) => {
                            if (data.modelKey !== model.key) return;
                            progressBar.style.width = `${data.progress.toFixed(1)}%`;
                            progressText.textContent = `${data.progress.toFixed(1)}%（${utils.formatFileSize(data.downloaded)} / ${utils.formatFileSize(data.total)}）`;
                        });
                        try {
                            const result = await electronAPI.whisper.downloadModel(model.key);
                            if (!result || !result.success) throw new Error((result && result.error) || '下载失败');
                            const selected = await electronAPI.whisper.setModel(model.key);
                            if (!selected || !selected.success) throw new Error((selected && selected.error) || '设置模型失败');
                            this.showMessage(`${model.label} 下载完成并已启用`, 'success');
                            refresh();
                        } catch (error) {
                            this.showMessage('下载失败: ' + error.message, 'error');
                            progressWrap.style.display = 'none';
                            downloadBtn.disabled = false;
                        } finally {
                            unsub();
                        }
                    });
                    actions.appendChild(downloadBtn);
                }
                container.appendChild(row);
            }
        };

        await refresh();
    },

    async showSettingsDialog() {
        try {
            // 获取当前设置
            const targetLufs = await electronAPI.database.getSetting('volume_target_lufs', -16);
            const volumeSyncEnabled = await electronAPI.database.getSetting('volume_sync_enabled', true);
            const volumeStats = await electronAPI.volume.getStats();

            // 获取隐私设置（多键位格式）
            let privacySettings = {
                enabled: true,
                keys: { overlay: 'F9', overlay_minimize: '', audio_only: '', quit: '' },
                toolbarAction: 'overlay'
            };
            try {
                const privacyResult = await electronAPI.privacy.getSettings();
                if (privacyResult && privacyResult.success && privacyResult.settings) {
                    privacySettings = { ...privacySettings, ...privacyResult.settings };
                    if (!privacySettings.keys) {
                        privacySettings.keys = { overlay: 'F9', overlay_minimize: '', audio_only: '', quit: '' };
                    }
                }
            } catch (error) {
                console.error('获取隐私设置失败:', error);
            }

            // 顺序与主进程 privacyActions 一致：从常规到极端
            const actionNames = {
                overlay: '暂停并全屏遮罩',
                overlay_minimize: '暂停、遮罩并最小化窗口',
                audio_only: '继续播放，只遮住屏幕（戴耳机时用）',
                quit: '直接退出应用'
            };

            // 获取网络设置（代理 / cookies）
            let networkSettings = { proxy: '', cookiesPath: '' };
            try {
                const savedProxy = await electronAPI.database.getSetting('download_proxy', '');
                const savedCookies = await electronAPI.database.getSetting('cookies_path', '');
                networkSettings.proxy = (savedProxy && typeof savedProxy === 'string') ? savedProxy : '';
                networkSettings.cookiesPath = (savedCookies && typeof savedCookies === 'string') ? savedCookies : '';
            } catch (error) {
                console.error('获取网络设置失败:', error);
            }

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
                <div class="modal-content" style="width: 720px; max-width: calc(100vw - 48px); height: 620px; max-height: calc(100vh - 60px);">
                    <div class="modal-header">
                        <h3>设置</h3>
                        <button class="close-btn" aria-label="关闭">×</button>
                    </div>
                    <div class="modal-body" style="padding: 0;">
                        <div class="settings-content-wrapper">
                            <div class="settings-sidebar-nav">
                                <div class="settings-nav-item active" data-panel="volume-sync">音量同步</div>
                                <div class="settings-nav-item" data-panel="privacy">隐私与老板键</div>
                                <div class="settings-nav-item" data-panel="network">网络与下载</div>
                                <div class="settings-nav-item" data-panel="storage">存储位置</div>
                                <div class="settings-nav-item" data-panel="ai">AI 歌词识别</div>
                                <div class="settings-nav-item" data-panel="about">关于与更新</div>
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
                                                    <span class="stat-value">${volumeStats.analyzed} 项</span>
                                                </div>
                                                <div class="stat-item">
                                                    <span class="stat-label">未分析</span>
                                                    <span class="stat-value">${volumeStats.unanalyzed} 项</span>
                                                </div>
                                                <div class="stat-item">
                                                    <span class="stat-label">总计</span>
                                                    <span class="stat-value">${volumeStats.total} 项</span>
                                                </div>
                                            </div>

                                            <div class="setting-actions">
                                                <button class="btn btn-secondary" id="batch-analyze-btn" ${volumeStats.unanalyzed === 0 ? 'disabled' : ''}>
                                                    批量同步全部
                                                </button>
                                                <button class="btn btn-secondary" id="reset-volume-btn">重置为默认</button>
                                            </div>
                                            <small style="font-size: 11.5px; color: var(--text-faint);">开关与目标响度改动即时生效（调整目标响度会自动重算已分析内容的增益）。</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- 隐私与老板键面板 -->
                                <div class="settings-content-panel" id="panel-privacy">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <div class="checkbox-wrapper">
                                                    <input type="checkbox" id="privacy-enabled" ${privacySettings.enabled ? 'checked' : ''}>
                                                    <label for="privacy-enabled">启用老板键（全局快捷键，在其他应用或游戏中也能触发）</label>
                                                </div>
                                            </div>

                                            <div class="setting-item">
                                                <label>动作与键位</label>
                                                <small>每种动作可绑定独立快捷键（同一时间只响应一个键）。遮罩状态下再按任意老板键即恢复界面；"直接退出"不可恢复。</small>
                                            </div>

                                            ${Object.entries(actionNames).map(([action, name]) => `
                                            <div class="setting-item privacy-key-row" data-action="${action}">
                                                <div class="privacy-key-row-inner">
                                                    <span class="privacy-key-name">${name}</span>
                                                    <span class="key-display" data-role="key-display">${utils.escapeHtml(privacySettings.keys[action] || '未绑定')}</span>
                                                    <button class="btn btn-secondary privacy-record-btn" data-action="${action}">录制</button>
                                                    <button class="btn btn-secondary privacy-clear-btn" data-action="${action}" ${privacySettings.keys[action] ? '' : 'disabled'}>清除</button>
                                                </div>
                                            </div>
                                            `).join('')}

                                            <div class="setting-item">
                                                <label>标题栏隐私按钮的动作</label>
                                                <select id="privacy-toolbar-action" style="padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text); max-width: 260px;">
                                                    ${Object.entries(actionNames).map(([action, name]) =>
                                                        `<option value="${action}" ${privacySettings.toolbarAction === action ? 'selected' : ''}>${name}</option>`
                                                    ).join('')}
                                                </select>
                                                <small>点击窗口右上角的隐私按钮（或按 Ctrl+Shift+H）时执行的动作；默认"暂停并全屏遮罩"（正在播放会立即暂停并隐藏整个界面）。触发后若桌面歌词窗口打开会一并隐藏，退出隐私模式后自动恢复（"直接退出"除外）。</small>
                                            </div>

                                            <div class="setting-actions">
                                                <button class="btn btn-secondary" id="test-privacy-btn">立即体验（标题栏按钮动作）</button>
                                            </div>
                                            <small style="font-size: 11.5px; color: var(--text-faint);">所有改动即时生效并保存，无需手动保存。</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- 网络与下载面板 -->
                                <div class="settings-content-panel" id="panel-network">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <label>代理地址</label>
                                                <input type="text" id="download-proxy" value="${utils.escapeHtml(networkSettings.proxy)}" placeholder="http://127.0.0.1:7890" style="height: 36px; padding: 0 12px; font-size: 13.5px; color: var(--text); background: var(--surface-2); border: 1px solid transparent; border-radius: 8px; outline: none; max-width: 320px;">
                                                <small>下载 YouTube 内容通常需要代理；B站一般无需设置。留空表示直连。</small>
                                            </div>

                                            <div class="setting-item">
                                                <label>cookies.txt（可选）</label>
                                                <div class="range-container">
                                                    <span id="cookies-path-display" style="flex: 1; min-width: 0; font-size: 12px; color: var(--text-muted); padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${utils.escapeHtml(networkSettings.cookiesPath || '未选择')}</span>
                                                    <button class="btn btn-secondary" id="select-cookies-btn">选择文件</button>
                                                    <button class="btn btn-secondary" id="clear-cookies-btn" ${networkSettings.cookiesPath ? '' : 'style="display:none;"'}>清除</button>
                                                </div>
                                                <small>使用浏览器导出的 cookies.txt 可下载需要登录的内容（如年龄限制视频）。</small>
                                            </div>

                                            <small style="font-size: 11.5px; color: var(--text-faint); margin-top: 8px;">改动即时生效并保存。</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- AI 歌词识别面板 -->
                                <div class="settings-content-panel" id="panel-ai">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <label>语音识别模型</label>
                                                <small>音频转歌词使用本地 AI 模型（whisper，中/英/日/俄/法/德等多语言自动检测）。推荐 Small 以获得更好的歌词准确率；当前使用的模型不可删除，其他已下载模型可删除释放空间。</small>
                                            </div>
                                            <div id="settings-whisper-model-list"></div>
                                            <div class="setting-actions">
                                                <button class="btn btn-secondary" id="batch-transcribe-btn">批量识别已有内容</button>
                                            </div>
                                            <small style="font-size: 11.5px; color: var(--text-faint);">「批量识别」对库里还没有歌词的内容逐个本地识别（无需重新下载），也可右键单个内容识别。</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- 存储位置面板 -->
                                <div class="settings-content-panel" id="panel-storage">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <label>音乐存储位置</label>
                                                <small>默认在 C 盘用户数据目录（Windows 规范：安装目录无写入权限且卸载会丢数据）。音乐文件较大，可改存到其他盘，已有文件会自动迁移。</small>
                                            </div>
                                            <div class="setting-item">
                                                <div id="storage-current-info" style="font-size: 12.5px; color: var(--text-muted); background: var(--surface-2); border-radius: 8px; padding: 10px 12px; line-height: 1.7; word-break: break-all;">加载中...</div>
                                            </div>
                                            <div class="setting-actions">
                                                <button class="btn btn-primary" id="storage-change-btn">更改存储位置</button>
                                                <button class="btn btn-secondary" id="storage-refresh-btn">刷新</button>
                                            </div>
                                            <small style="font-size: 11.5px; color: var(--text-faint);">更改时会复制全部音乐文件到新位置并更新数据库记录，完成后自动清理旧目录（歌词、缩略图等小文件仍在用户数据目录）。</small>
                                        </div>
                                    </div>
                                </div>

                                <!-- 关于与更新面板 -->
                                <div class="settings-content-panel" id="panel-about">
                                    <div class="settings-section">
                                        <div class="settings-group">
                                            <div class="setting-item">
                                                <label>当前版本</label>
                                                <span style="font-size: 15px; font-weight: 700; color: var(--accent);">${versionText}</span>
                                            </div>
                                            <div class="setting-item">
                                                <label>检查更新</label>
                                                <small>启动联网时会自动检查一次（静默，仅在有新版本时提示）。也可立即手动检查。</small>
                                            </div>
                                            <div class="setting-actions">
                                                <button class="btn btn-primary" id="check-update-btn">立即检查更新</button>
                                            </div>
                                            <div id="update-result" style="display:none; font-size: 12.5px; line-height: 1.7; color: var(--text-muted); background: var(--surface-2); border-radius: 8px; padding: 10px 12px;"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 检查控制台面板 -->
                                <div class="settings-content-panel" id="panel-console">
                                    <div class="console-group-title">界面</div>
                                    <div class="console-actions">
                                        <button id="console-refresh-ui-btn" class="btn btn-success">刷新界面</button>
                                        <button id="check-ui-btn" class="btn btn-info">检查UI状态</button>
                                    </div>
                                    <div class="console-group-title">文件</div>
                                    <div class="console-actions">
                                        <button id="check-songs-btn" class="btn btn-primary">检查文件状态</button>
                                        <button id="clean-missing-btn" class="btn btn-warning">清理缺失文件</button>
                                    </div>
                                    <div class="console-group-title">工具</div>
                                    <div class="console-actions">
                                        <button id="ytdlp-update-btn" class="btn btn-success">检查 yt-dlp 更新</button>
                                        <button id="diagnose-tools-btn" class="btn btn-info">诊断工具状态</button>
                                        <button id="force-download-btn" class="btn btn-warning">强制重新下载工具</button>
                                        <button id="open-devtools-btn" class="btn btn-secondary">打开开发者工具</button>
                                    </div>
                                    <div id="console-output" class="console-output"><p style="color: var(--text-faint);">尚无输出，点击上方按钮执行检查</p></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <span style="font-size: 12px; color: var(--text-muted); margin-right: auto;">当前版本: ${versionText}</span>
                        <button class="btn btn-secondary" data-role="close">关闭</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            const closeDialog = () => dialog.remove();
            dialog.querySelector('.close-btn').addEventListener('click', closeDialog);
            dialog.querySelector('[data-role="close"]').addEventListener('click', closeDialog);

            // ==================== 侧边导航切换 ====================
            const navItems = dialog.querySelectorAll('.settings-nav-item');
            const panels = dialog.querySelectorAll('.settings-content-panel');

            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    const targetPanel = item.dataset.panel;

                    navItems.forEach(nav => nav.classList.remove('active'));
                    item.classList.add('active');

                    panels.forEach(panel => {
                        panel.classList.remove('active');
                        if (panel.id === `panel-${targetPanel}`) {
                            panel.classList.add('active');
                        }
                    });
                });
            });

            // ==================== 音量同步事件绑定（即时生效） ====================
            const targetLufsInput = dialog.querySelector('#volume-target-lufs');
            const targetLufsValue = dialog.querySelector('#volume-target-value');

            if (targetLufsInput && targetLufsValue) {
                targetLufsInput.addEventListener('input', (e) => {
                    targetLufsValue.textContent = `${e.target.value} LUFS`;
                });
            }

            // 开关即时生效
            const volumeSyncToggle = dialog.querySelector('#volume-sync-enabled');
            if (volumeSyncToggle) {
                volumeSyncToggle.addEventListener('change', async () => {
                    try {
                        await electronAPI.database.setSetting('volume_sync_enabled', volumeSyncToggle.checked);
                        this.showMessage(volumeSyncToggle.checked ? '音量自动平衡已启用' : '音量自动平衡已停用', 'info');
                    } catch (error) {
                        this.showMessage('保存失败: ' + error.message, 'error');
                    }
                });
            }

            // 目标响度：松手（change）时保存并重算增益
            if (targetLufsInput) {
                targetLufsInput.addEventListener('change', async () => {
                    const newTargetLufs = parseInt(targetLufsInput.value);
                    try {
                        await electronAPI.database.setSetting('volume_target_lufs', newTargetLufs);
                        if (newTargetLufs !== targetLufs) {
                            this.showMessage('正在更新已分析内容的音量增益...', 'info');
                            const result = await electronAPI.volume.batchUpdateGains(newTargetLufs);
                            this.showMessage(result.updated > 0
                                ? `目标响度已设为 ${newTargetLufs} LUFS，已更新 ${result.updated} 项增益`
                                : `目标响度已设为 ${newTargetLufs} LUFS`, 'success');
                            await this.refreshCurrentView();
                        }
                    } catch (error) {
                        this.showMessage('保存失败: ' + error.message, 'error');
                    }
                });
            }

            const batchAnalyzeBtn = dialog.querySelector('#batch-analyze-btn');
            if (batchAnalyzeBtn && volumeStats.unanalyzed > 0) {
                batchAnalyzeBtn.addEventListener('click', () => {
                    dialog.remove();
                    this.showBatchAnalyzeDialog();
                });
            }

            const resetBtn = dialog.querySelector('#reset-volume-btn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    if (targetLufsInput) {
                        targetLufsInput.value = -16;
                        targetLufsValue.textContent = '-16 LUFS';
                    }
                });
            }

            // ==================== 隐私与老板键事件绑定（多键位，即时生效） ====================
            const pendingKeys = { ...privacySettings.keys };

            // 即时保存（改动即生效，无需保存按钮）
            const applyPrivacyNow = async () => {
                try {
                    const result = await electronAPI.privacy.setSettings({
                        enabled: dialog.querySelector('#privacy-enabled').checked,
                        keys: { ...pendingKeys },
                        toolbarAction: dialog.querySelector('#privacy-toolbar-action').value
                    });
                    if (!result.success) {
                        this.showMessage(result.error || '应用失败', 'error');
                    }
                } catch (error) {
                    this.showMessage('应用失败: ' + error.message, 'error');
                }
            };

            dialog.querySelector('#privacy-enabled').addEventListener('change', () => {
                applyPrivacyNow().then(() => this.showMessage(privacySettings.enabled = dialog.querySelector('#privacy-enabled').checked ? '老板键已启用' : '老板键已停用', 'info'));
            });

            dialog.querySelector('#privacy-toolbar-action').addEventListener('change', () => {
                applyPrivacyNow();
            });

            // 保险：对话框以任何方式关闭时恢复全局快捷键（防录制中途关窗后老板键失效）
            const originalDialogRemove = dialog.remove.bind(dialog);
            dialog.remove = () => {
                electronAPI.privacy.resumeShortcuts().catch(() => {});
                originalDialogRemove();
            };

            const refreshKeyRow = (action) => {
                const row = dialog.querySelector(`.privacy-key-row[data-action="${action}"]`);
                if (!row) return;
                const display = row.querySelector('[data-role="key-display"]');
                const clearBtn = row.querySelector('.privacy-clear-btn');
                if (display) {
                    display.textContent = pendingKeys[action] || '未绑定';
                    display.classList.toggle('bound', !!pendingKeys[action]);
                }
                if (clearBtn) clearBtn.disabled = !pendingKeys[action];
            };

            // 录制按钮（每行动作独立）
            // 注意：录制期间必须暂停全局快捷键，否则按已注册的老板键会在系统层被拦截
            // 直接触发遮罩动作，录制事件到不了这里——那就是"覆盖录不上"的原因
            dialog.querySelectorAll('.privacy-record-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const action = btn.dataset.action;
                    const original = btn.textContent;
                    btn.textContent = '按键…';

                    try { await electronAPI.privacy.suspendShortcuts(); } catch (e) { /* 忽略 */ }

                    const finishRecording = () => {
                        btn.textContent = original;
                        document.removeEventListener('keydown', onKey, true);
                        electronAPI.privacy.resumeShortcuts().catch(() => {});
                    };

                    const onKey = (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        if (e.key === 'Escape') {
                            // 取消录制，保持原键位
                        } else if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                            const parts = [];
                            if (e.ctrlKey) parts.push('Ctrl');
                            if (e.altKey) parts.push('Alt');
                            if (e.shiftKey) parts.push('Shift');

                            let key = e.key;
                            if (key === ' ') key = 'Space';
                            if (key.length === 1) key = key.toUpperCase();
                            parts.push(key);

                            // 同一键不能绑两个动作：若已被其他动作占用则顶掉旧的
                            const newAcc = parts.join('+');
                            for (const other of Object.keys(pendingKeys)) {
                                if (other !== action && pendingKeys[other] && pendingKeys[other].toLowerCase() === newAcc.toLowerCase()) {
                                    pendingKeys[other] = '';
                                    refreshKeyRow(other);
                                }
                            }
                            pendingKeys[action] = newAcc;
                            refreshKeyRow(action);
                            applyPrivacyNow();
                        } else {
                            return;
                        }

                        finishRecording();
                    };

                    document.addEventListener('keydown', onKey, true);
                });
            });

            // 清除按钮
            dialog.querySelectorAll('.privacy-clear-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    pendingKeys[action] = '';
                    refreshKeyRow(action);
                    applyPrivacyNow();
                });
            });

            const testPrivacyBtn = dialog.querySelector('#test-privacy-btn');
            const savePrivacyBtn = dialog.querySelector('#save-privacy-btn');

            if (testPrivacyBtn) {
                testPrivacyBtn.addEventListener('click', () => {
                    dialog.remove();
                    PrivacyMode.toggle();
                });
            }

            if (savePrivacyBtn) {
                savePrivacyBtn.addEventListener('click', async () => {
                    try {
                        const newSettings = {
                            enabled: dialog.querySelector('#privacy-enabled').checked,
                            keys: { ...pendingKeys },
                            toolbarAction: dialog.querySelector('#privacy-toolbar-action').value
                        };

                        const result = await electronAPI.privacy.setSettings(newSettings);

                        if (result.success) {
                            this.showMessage('隐私设置已保存', 'success');
                            dialog.remove();
                        } else {
                            this.showMessage(result.error || '保存失败', 'error');
                        }
                    } catch (error) {
                        logger.error('保存隐私设置失败:', error);
                        this.showMessage('保存失败: ' + error.message, 'error');
                    }
                });
            }

            // ==================== 网络与下载事件绑定（即时生效） ====================
            const proxyInput = dialog.querySelector('#download-proxy');
            const cookiesDisplay = dialog.querySelector('#cookies-path-display');
            const selectCookiesBtn = dialog.querySelector('#select-cookies-btn');
            const clearCookiesBtn = dialog.querySelector('#clear-cookies-btn');
            let pendingCookiesPath = networkSettings.cookiesPath;

            const saveNetworkNow = async (toastText) => {
                try {
                    const proxy = (proxyInput && proxyInput.value) ? proxyInput.value.trim() : '';
                    await electronAPI.database.setSetting('download_proxy', proxy);
                    await electronAPI.database.setSetting('cookies_path', pendingCookiesPath || '');
                    if (toastText) this.showMessage(toastText, 'success');
                } catch (error) {
                    this.showMessage('保存失败: ' + error.message, 'error');
                }
            };

            // 代理：失焦或回车时保存
            if (proxyInput) {
                proxyInput.addEventListener('change', () => saveNetworkNow('代理设置已保存'));
                proxyInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); proxyInput.blur(); }
                });
            }

            if (selectCookiesBtn) {
                selectCookiesBtn.addEventListener('click', async () => {
                    try {
                        const filePath = await electronAPI.file.selectCookies();
                        if (filePath) {
                            pendingCookiesPath = filePath;
                            if (cookiesDisplay) cookiesDisplay.textContent = filePath;
                            if (clearCookiesBtn) clearCookiesBtn.style.display = '';
                            saveNetworkNow('cookies 已设置');
                        }
                    } catch (error) {
                        logger.error('选择 cookies 文件失败:', error);
                    }
                });
            }

            if (clearCookiesBtn) {
                clearCookiesBtn.addEventListener('click', () => {
                    pendingCookiesPath = '';
                    if (cookiesDisplay) cookiesDisplay.textContent = '未选择';
                    clearCookiesBtn.style.display = 'none';
                    saveNetworkNow('cookies 已清除');
                });
            }

            // ==================== AI 歌词识别事件绑定 ====================
            await this.renderWhisperModelsInSettings(dialog.querySelector('#settings-whisper-model-list'));

            const batchTranscribeBtn = dialog.querySelector('#batch-transcribe-btn');
            if (batchTranscribeBtn) {
                batchTranscribeBtn.addEventListener('click', async () => {
                    dialog.remove();
                    await this.batchTranscribe();
                });
            }

            // ==================== 关于与更新事件绑定 ====================
            const checkUpdateBtn = dialog.querySelector('#check-update-btn');
            const updateResult = dialog.querySelector('#update-result');
            if (checkUpdateBtn) {
                checkUpdateBtn.addEventListener('click', async () => {
                    checkUpdateBtn.disabled = true;
                    if (updateResult) {
                        updateResult.style.display = 'block';
                        updateResult.textContent = '正在检查更新...';
                    }
                    try {
                        const result = await electronAPI.updater.check();
                        if (updateResult) {
                            if (!result.success) {
                                updateResult.innerHTML = `<span style="color: var(--warning);">⚠ 检查失败</span>：${utils.escapeHtml(result.error || '网络问题')}（可稍后重试）`;
                            } else if (result.hasUpdate) {
                                updateResult.innerHTML = `<span style="color: var(--success);">✓ 发现新版本</span> v${utils.escapeHtml(result.remote)}（当前 v${utils.escapeHtml(result.current)}）<br><button class="btn btn-primary" id="go-download-page" style="margin-top:8px;">前往下载</button>`;
                                const goBtn = updateResult.querySelector('#go-download-page');
                                if (goBtn) {
                                    goBtn.addEventListener('click', async () => {
                                        try { await electronAPI.file.openExternal(result.url); } catch (e) { /* 忽略 */ }
                                    });
                                }
                            } else {
                                updateResult.innerHTML = `<span style="color: var(--success);">✓ 已是最新版本</span>（v${utils.escapeHtml(result.current)}）`;
                            }
                        }
                    } catch (error) {
                        if (updateResult) {
                            updateResult.innerHTML = `<span style="color: var(--warning);">⚠ 检查失败</span>：${utils.escapeHtml(error.message)}`;
                        }
                    } finally {
                        checkUpdateBtn.disabled = false;
                    }
                });
            }

            // 输出带时间戳的分隔头（控制台各命令共用）
            const consoleHeader = (title) => {
                const time = new Date().toLocaleTimeString();
                return `<p style="color: var(--text-faint); margin:10px 0 4px; border-top:1px solid var(--border); padding-top:8px;">── ${time} · ${title} ──</p>`;
            };

            // ==================== 存储位置事件绑定 ====================
            const storageInfoEl = dialog.querySelector('#storage-current-info');
            const storageChangeBtn = dialog.querySelector('#storage-change-btn');
            const storageRefreshBtn = dialog.querySelector('#storage-refresh-btn');

            const loadStorageInfo = async () => {
                if (!storageInfoEl) return;
                try {
                    const info = await electronAPI.storage.getInfo();
                    if (info.success) {
                        storageInfoEl.innerHTML = `
                            <strong style="color: var(--text);">当前目录：</strong>${utils.escapeHtml(info.musicDir)}${info.isDefault ? ' <span style="color: var(--text-faint);">（默认）</span>' : ''}<br>
                            <strong style="color: var(--text);">文件：</strong>${info.fileCount} 个，共 ${utils.formatFileSize(info.totalSize)}`;
                    } else {
                        storageInfoEl.textContent = '读取失败：' + (info.error || '未知错误');
                    }
                } catch (error) {
                    storageInfoEl.textContent = '读取失败：' + error.message;
                }
            };
            loadStorageInfo();

            if (storageRefreshBtn) {
                storageRefreshBtn.addEventListener('click', loadStorageInfo);
            }

            if (storageChangeBtn) {
                storageChangeBtn.addEventListener('click', async () => {
                    try {
                        const newDir = await electronAPI.storage.chooseDir();
                        if (!newDir) return;

                        const confirmed = await this.showConfirm({
                            title: '迁移存储位置',
                            message: `将把全部音乐文件迁移到：\n${newDir}\n\n过程会复制文件并更新数据库记录，期间请勿关闭应用。继续？`,
                            confirmText: '开始迁移'
                        });
                        if (!confirmed) return;

                        storageChangeBtn.disabled = true;
                        storageInfoEl.textContent = '正在迁移...';

                        const unsub = electronAPI.storage.onMigrateProgress((data) => {
                            if (storageInfoEl && data && data.text) storageInfoEl.textContent = data.text;
                        });

                        try {
                            const result = await electronAPI.storage.migrate(newDir);
                            unsub();
                            if (result.success) {
                                this.showMessage(`迁移完成：${result.copied} 个文件`, 'success');
                            } else {
                                this.showMessage('迁移失败：' + (result.error || '未知错误'), 'error');
                            }
                        } finally {
                            unsub();
                            storageChangeBtn.disabled = false;
                            loadStorageInfo();
                        }
                    } catch (error) {
                        this.showMessage('迁移失败: ' + error.message, 'error');
                        storageChangeBtn.disabled = false;
                    }
                });
            }

            // ==================== yt-dlp 检查更新 ====================
            const ytdlpUpdateBtn = dialog.querySelector('#ytdlp-update-btn');
            const ytdlpOutput = dialog.querySelector('#console-output');
            if (ytdlpUpdateBtn) {
                ytdlpUpdateBtn.addEventListener('click', async () => {
                    ytdlpUpdateBtn.disabled = true;
                    if (ytdlpOutput) ytdlpOutput.innerHTML = consoleHeader('检查 yt-dlp 更新') + '<p>正在查询本地与最新版本...</p>';
                    try {
                        const result = await electronAPI.tools.checkUpdate();
                        if (!result.success) {
                            if (ytdlpOutput) ytdlpOutput.innerHTML = consoleHeader('检查 yt-dlp 更新') + `<p style="color: var(--warning);">⚠ 检查失败：${utils.escapeHtml(result.error || '')}</p>`;
                            return;
                        }
                        if (!result.hasUpdate) {
                            if (ytdlpOutput) ytdlpOutput.innerHTML = consoleHeader('检查 yt-dlp 更新') + `<p style="color: var(--success);">✓ 已是最新版本 ${utils.escapeHtml(result.local)}</p>`;
                            return;
                        }
                        // 有新版本：提示并直接更新
                        if (ytdlpOutput) {
                            ytdlpOutput.innerHTML = consoleHeader('检查 yt-dlp 更新') +
                                `<p>本地版本：<strong>${utils.escapeHtml(result.local)}</strong> → 最新版本：<strong style="color: var(--accent);">${utils.escapeHtml(result.remote)}</strong></p>` +
                                '<p>正在下载最新版（约 17MB，下载后自动生效）...</p>';
                        }
                        const updateResult = await electronAPI.tools.updateYtDlp();
                        if (updateResult.success) {
                            if (ytdlpOutput) ytdlpOutput.innerHTML += `<p style="color: var(--success);">✓ 更新完成，新版已生效</p>`;
                            this.showMessage('yt-dlp 已更新到 ' + result.remote, 'success');
                        } else {
                            if (ytdlpOutput) ytdlpOutput.innerHTML += `<p style="color: var(--error);">❌ 下载失败：${utils.escapeHtml(updateResult.error || '')}</p>`;
                        }
                    } catch (error) {
                        if (ytdlpOutput) ytdlpOutput.innerHTML += `<p style="color: var(--error);">❌ ${utils.escapeHtml(error.message)}</p>`;
                    } finally {
                        ytdlpUpdateBtn.disabled = false;
                    }
                });
            }

            // ==================== 检查控制台事件绑定 ====================
            const output = dialog.querySelector('#console-output');
            const refreshUIBtn = dialog.querySelector('#console-refresh-ui-btn');
            const checkSongsBtn = dialog.querySelector('#check-songs-btn');
            const cleanMissingBtn = dialog.querySelector('#clean-missing-btn');
            const checkUIBtn = dialog.querySelector('#check-ui-btn');
            const diagnoseToolsBtn = dialog.querySelector('#diagnose-tools-btn');
            const forceDownloadBtn = dialog.querySelector('#force-download-btn');
            const openDevToolsBtn = dialog.querySelector('#open-devtools-btn');

            if (refreshUIBtn) {
                refreshUIBtn.addEventListener('click', async () => {
                    output.innerHTML = consoleHeader('刷新界面') + '<p>正在刷新界面...</p>';
                    try {
                        await this.refreshUI();
                        output.innerHTML = '<p style="color: var(--success);">✅ 界面刷新成功！</p>';
                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ 界面刷新失败: ${utils.escapeHtml(error.message)}</p>`;
                    }
                });
            }

            if (checkSongsBtn) {
                checkSongsBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = consoleHeader('检查文件状态') + '<p>正在检查文件状态...</p>';
                        const missingFiles = await electronAPI.file.checkSongsStatus();

                        if (missingFiles.length === 0) {
                            output.innerHTML = '<p style="color: var(--success);">✅ 所有文件都存在！</p>';
                        } else {
                            let html = `<p style="color: var(--warning);">⚠️ 发现 ${missingFiles.length} 个缺失文件:</p><ul>`;
                            missingFiles.forEach(file => {
                                html += `<li>${utils.escapeHtml(file.title)} - ${utils.escapeHtml(file.path)}</li>`;
                            });
                            html += '</ul>';
                            output.innerHTML = html;
                        }
                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ 检查失败: ${utils.escapeHtml(error.message)}</p>`;
                    }
                });
            }

            if (cleanMissingBtn) {
                cleanMissingBtn.addEventListener('click', async () => {
                    const confirmed = await this.showConfirm({
                        title: '清理缺失文件',
                        message: '确定要清理所有缺失的文件记录吗？这将从数据库中移除文件不存在的内容记录。',
                        confirmText: '清理',
                        danger: true
                    });

                    if (!confirmed) return;

                    try {
                        output.innerHTML = consoleHeader('清理缺失文件') + '<p>正在清理缺失文件...</p>';
                        const result = await electronAPI.file.cleanMissingSongs();

                        output.innerHTML = `<p style="color: var(--success);">✅ 清理完成！共清理了 ${result.cleanedCount} 个缺失文件记录。</p>`;

                        await this.refreshCurrentView();
                        await this.loadPlaylistsToSidebar();
                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ 清理失败: ${utils.escapeHtml(error.message)}</p>`;
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

                        let html = consoleHeader('检查UI状态') + '<h4>UI状态检查结果:</h4>';

                        if (searchInput) {
                            html += `<p><strong>搜索框:</strong> ✅ 存在</p>`;
                            html += `<p>- 可见性: ${searchInput.style.display !== 'none' ? '✅ 可见' : '❌ 隐藏'}</p>`;
                            html += `<p>- 是否禁用: ${searchInput.disabled ? '❌ 禁用' : '✅ 启用'}</p>`;
                            html += `<p>- 当前焦点: ${document.activeElement === searchInput ? '✅ 有焦点' : '❌ 无焦点'}</p>`;
                        } else {
                            html += `<p><strong>搜索框:</strong> ❌ 不存在</p>`;
                        }

                        if (audioPlayer) {
                            html += `<p><strong>音频播放器:</strong> ✅ 存在（状态: ${audioPlayer.readyState}）</p>`;
                        } else {
                            html += `<p><strong>音频播放器:</strong> ❌ 不存在</p>`;
                        }

                        html += `<p><strong>播放器状态:</strong></p>`;
                        html += `<p>- 当前条目: ${utils.escapeHtml(this.currentSong ? this.currentSong.title : '无')}</p>`;
                        html += `<p>- 播放列表长度: ${this.playlist.length}</p>`;
                        html += `<p>- 是否在播放: ${this.isPlaying ? '✅ 是' : '❌ 否'}</p>`;
                        html += `<p>- 当前视图: ${utils.escapeHtml(this.currentView)}</p>`;

                        output.innerHTML = html;
                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ UI状态检查失败: ${utils.escapeHtml(error.message)}</p>`;
                    }
                });
            }

            if (diagnoseToolsBtn) {
                diagnoseToolsBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = consoleHeader('诊断工具状态') + '<p>正在诊断工具状态...</p>';

                        const tools = ['yt-dlp', 'ffmpeg', 'whisper'];
                        let html = '<h4>工具诊断结果:</h4>';

                        for (const tool of tools) {
                            const diagnosis = await electronAPI.tools.diagnose(tool);

                            html += `<div style="margin-bottom: 14px; padding: 10px; border: 1px solid var(--border); border-radius: 8px;">`;
                            html += `<h5>${tool.toUpperCase()}</h5>`;
                            html += `<p><strong>工具路径:</strong> ${utils.escapeHtml(diagnosis.toolPath || '未知')}</p>`;
                            html += `<p><strong>平台:</strong> ${utils.escapeHtml(diagnosis.platform)}</p>`;
                            html += `<p><strong>bin目录存在:</strong> ${diagnosis.binDirExists ? '✅ 是' : '❌ 否'}</p>`;
                            html += `<p><strong>文件存在:</strong> ${diagnosis.fileExists ? '✅ 是' : '❌ 否'}</p>`;

                            if (diagnosis.fileExists) {
                                html += `<p><strong>文件大小:</strong> ${diagnosis.fileSize} 字节</p>`;
                            }

                            html += `<p><strong>系统工具可用:</strong> ${diagnosis.systemToolAvailable ? '✅ 是' : '❌ 否'}</p>`;

                            if (diagnosis.issues.length > 0) {
                                html += `<p><strong>问题:</strong></p><ul>`;
                                diagnosis.issues.forEach(issue => {
                                    html += `<li style="color: var(--error);">${utils.escapeHtml(issue)}</li>`;
                                });
                                html += `</ul>`;
                            }

                            if (diagnosis.recommendations.length > 0) {
                                html += `<p><strong>建议:</strong></p><ul>`;
                                diagnosis.recommendations.forEach(rec => {
                                    html += `<li style="color: var(--info);">${utils.escapeHtml(rec)}</li>`;
                                });
                                html += `</ul>`;
                            }

                            html += `</div>`;
                        }

                        output.innerHTML = html;
                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ 诊断失败: ${utils.escapeHtml(error.message)}</p>`;
                    }
                });
            }

            if (forceDownloadBtn) {
                forceDownloadBtn.addEventListener('click', async () => {
                    try {
                        output.innerHTML = consoleHeader('强制重新下载工具') + '<p>正在强制重新下载工具...</p>';

                        const tools = ['yt-dlp', 'ffmpeg', 'whisper'];
                        let html = '<h4>强制重新下载结果:</h4>';

                        for (const tool of tools) {
                            try {
                                html += `<p>正在下载 ${tool}...</p>`;
                                output.innerHTML = html;

                                const result = await electronAPI.tools.forceDownload(tool);

                                if (result.success) {
                                    html += `<p style="color: var(--success);">✅ ${tool} 重新下载成功</p>`;
                                } else {
                                    html += `<p style="color: var(--error);">❌ ${tool} 重新下载失败: ${utils.escapeHtml(result.message || '')}</p>`;
                                }
                            } catch (error) {
                                html += `<p style="color: var(--error);">❌ ${tool} 重新下载失败: ${utils.escapeHtml(error.message)}</p>`;
                            }

                            output.innerHTML = html;
                        }

                        html += '<p><strong>下载完成！请重试您的操作。</strong></p>';
                        output.innerHTML = html;

                    } catch (error) {
                        output.innerHTML = `<p style="color: var(--error);">❌ 强制重新下载失败: ${utils.escapeHtml(error.message)}</p>`;
                    }
                });
            }

        } catch (error) {
            logger.error('显示设置对话框失败:', error);
            this.showMessage('无法打开设置', 'error');
        }
    },

    // ---------- 批量音量同步 ----------

    async showBatchAnalyzeDialog() {
        try {
            const unanalyzedSongs = await electronAPI.volume.getUnanalyzedSongs();

            if (!unanalyzedSongs || unanalyzedSongs.length === 0) {
                this.showMessage('没有需要同步的内容', 'info');
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
                <div class="modal-content" style="width: 450px;">
                    <div class="modal-header">
                        <h3>正在同步音量</h3>
                    </div>
                    <div class="modal-body">
                        <div class="batch-analyze-progress">
                            <div class="progress-bar-container" style="height: 8px;">
                                <div class="progress-bar">
                                    <div class="batch-analyze-progress-bar" id="analyze-progress-bar" style="width: 0%"></div>
                                </div>
                            </div>
                            <div class="analyze-stats">
                                <p>当前：<strong id="current-song-name">准备中...</strong></p>
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

            const pauseBtn = dialog.querySelector('#pause-analyze-btn');
            const cancelBtn = dialog.querySelector('#cancel-analyze-btn');

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

            const analyzeNext = async () => {
                if (isCancelled || currentSongIndex >= totalSongs) {
                    setTimeout(() => {
                        if (dialog.parentNode) dialog.remove();
                        this.showMessage(`批量同步完成！成功：${successCount}，失败：${failCount}`, 'success');
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

                const progressBar = dialog.querySelector('#analyze-progress-bar');
                const progressText = dialog.querySelector('#analyze-progress-text');
                const songNameEl = dialog.querySelector('#current-song-name');
                const successCountEl = dialog.querySelector('#success-count');
                const failCountEl = dialog.querySelector('#fail-count');

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
                    logger.error(`同步失败: ${song.title}`, error);
                    failCount++;
                    if (failCountEl) failCountEl.textContent = failCount;
                }

                currentSongIndex++;
                setTimeout(analyzeNext, 100);
            };

            analyzeNext();

        } catch (error) {
            logger.error('批量同步失败:', error);
            this.showMessage('批量同步失败', 'error');
        }
    }
};
