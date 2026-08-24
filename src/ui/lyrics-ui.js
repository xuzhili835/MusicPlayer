// 歌词功能（mixin：挂载到 MusicPlayer.prototype）
// 包含：歌词加载/桌面歌词同步、AI 音频转歌词（whisper）、图片 OCR 导入、歌词编辑
window.LyricsUI = {
    async loadLyrics(songTitle) {
        try {
            const result = await electronAPI.lyrics.get(songTitle);
            // 主进程返回 {success, lyrics: [{time, text}]}，校验为数组再使用
            this.currentLyrics = (result && result.success && Array.isArray(result.lyrics) && result.lyrics.length)
                ? result.lyrics : null;
            this.plainLyricsShown = null;
            this.lastDesktopLyric = null;
            this.lastDesktopLyricNext = null;
            this._lyricsOffsetMs = (result && typeof result.offsetMs === 'number') ? result.offsetMs : 0;
            this._lyricsSource = (result && result.source) || '';
            if (!this.currentLyrics) this.updateDesktopLyrics('♪ 暂无有效歌词 ♪');
        } catch (error) {
            logger.error('加载歌词失败:', error);
            this.currentLyrics = null;
            this.lastDesktopLyric = null;
            this.updateDesktopLyrics('♪ 暂无有效歌词 ♪');
        }
        // 立即推一次当前行：识别/下载完成、切歌后桌面歌词马上反映新歌词，
        // 不依赖同步循环的下一个 tick
        this.updateLyrics();
        this.updateLyricsButtonState();
    },

    startLyricsSync() {
        if (this.lyricsInterval) {
            clearInterval(this.lyricsInterval);
        }

        // 常驻同步循环：不挂在 play/pause 生命周期上（暂停即停曾导致
        // "桌面歌词卡住不动、手动开关窗口才更新一次"）。文本去重后
        // 空转开销可忽略，200ms 足够顺滑。
        this.lyricsInterval = setInterval(() => {
            this.updateLyrics();
        }, 200);
    },

    updateLyrics() {
        if (!this.audio) return;
        if (!this.currentLyrics || !Array.isArray(this.currentLyrics) || this.currentLyrics.length === 0) {
            this.updateDesktopLyrics('♪ 暂无有效歌词 ♪');
            return;
        }

        // 纯文本歌词（OCR 导入等，无时间轴）：桌面歌词固定显示第一行
        if (this.currentLyrics[0].time === null) {
            if (this.plainLyricsShown !== this.currentLyrics) {
                this.plainLyricsShown = this.currentLyrics;
                this.updateDesktopLyrics(this.currentLyrics[0].text);
            }
            return;
        }

        const currentTime = this.audio.currentTime;
        let idx = -1;

        for (let i = 0; i < this.currentLyrics.length; i++) {
            if (this.currentLyrics[i].time <= currentTime) {
                idx = i;
            } else {
                break;
            }
        }

        // 标准切换规则：每句标注时间（≈句首第一个字）一到即切换。
        // 时间轴的准确性由对齐保证（在线歌词逐句校准到本地演唱时刻），
        // 不在播放端做提前/滞后的猜测补偿。未到第一句的前奏期不显示
        // 第一句（挂着一句没在唱的词），显示前奏提示。
        const displayIdx = idx >= 0 ? idx : 0;
        this._currentLyricIndex = displayIdx;

        // 桌面歌词双行：当前句 + 下一句预览（半透明）。
        // 前奏：还没到第一句 → ♪ 前奏 ♪ + 第一句预览。
        // 长间奏：下一句还在 12s 之外且当前句已过 8s（大概率已唱完）→
        // ♪ 间奏 ♪ 而不是一直挂着上一句。主面板高亮保持当前行不变。
        const curLine = idx >= 0 ? this.currentLyrics[idx] : null;
        const nextLine = this.currentLyrics[idx >= 0 ? idx + 1 : 0];
        let curText;
        if (!curLine) {
            curText = '♪ 前奏 ♪';
        } else if (nextLine &&
            nextLine.time - currentTime > 12 && currentTime - curLine.time > 8) {
            curText = '♪ 间奏 ♪';
        } else {
            curText = curLine.text;
        }
        this.updateDesktopLyrics(
            curText,
            nextLine ? nextLine.text : ''
        );
        // 主窗口歌词面板：当前行高亮 + 滚动居中
        this.updateLyricsPanelHighlight(displayIdx);
    },

    updateDesktopLyrics(text, nextText = '') {
        const next = typeof text === 'string' && text.trim() ? text : '♪ 暂无有效歌词 ♪';
        const nextPreview = typeof nextText === 'string' ? nextText.trim() : '';
        // 去重：两行都相同才跳过
        if (this.lastDesktopLyric === next && this.lastDesktopLyricNext === nextPreview) return;
        this.lastDesktopLyric = next;
        this.lastDesktopLyricNext = nextPreview;
        electronAPI.lyrics.updateWindow({ current: next, next: nextPreview }).catch(() => {});
    },

    async toggleLyricsWindow() {
        try {
            const result = await electronAPI.lyrics.toggleWindow();
            this.desktopLyricsOpen = !!(result && result.visible);
            this.updateLyricsButtonState();
            // 保底：窗口打开后主动推一次当前歌词行。必须先清去重缓存——
            // 播放中内容未变时 updateDesktopLyrics 会因缓存命中直接跳过，
            // 新窗口收不到推送就一直停在占位文案（"歌词卡住"根源之一）
            if (this.desktopLyricsOpen) {
                setTimeout(() => {
                    this.lastDesktopLyric = null;
                    this.lastDesktopLyricNext = null;
                    this.updateLyrics();
                }, 400);
            }
        } catch (e) { /* 忽略 */ }
    },

    // 桌面歌词窗口被用户点 × 或主进程关闭时，同步按钮三态
    onLyricsWindowVisibility(visible) {
        this.desktopLyricsOpen = !!visible;
        this.updateLyricsButtonState();
    },

    // 「词」按钮三态：无歌词（暗灰）/ 有歌词未开窗（亮）/ 开窗中（樱花粉）
    updateLyricsButtonState() {
        const btn = document.getElementById('desktop-lyrics-btn');
        if (!btn) return;
        const hasLyrics = this.currentSong ? this.songHasLyrics(this.currentSong) : false;
        btn.classList.toggle('no-lyrics', !hasLyrics);
        btn.classList.toggle('lyrics-open', !!this.desktopLyricsOpen);
        btn.title = !hasLyrics
            ? '暂无歌词（右键歌曲可选 AI 识别）'
            : (this.desktopLyricsOpen ? '关闭桌面歌词' : '打开桌面歌词');
    },

    // 「词」按钮点击：无歌词时引导识别，否则开关桌面歌词窗口
    onDesktopLyricsButton() {
        if (this.currentSong && !this.songHasLyrics(this.currentSong)) {
            this.showMessage('这首歌还没有歌词，右键歌曲可选「AI 识别歌词」', 'info');
            return;
        }
        this.toggleLyricsWindow();
    },

    // 拉取"已有歌词"标题主干集合（列表标记用）
    async refreshLyricsStems() {
        try {
            const result = await electronAPI.lyrics.getExisting();
            if (result && result.success && Array.isArray(result.stems)) {
                this.lyricsStems = new Set(result.stems);
            }
        } catch (error) {
            logger.error('获取歌词清单失败:', error);
        }
        this.updateLyricsButtonState();
    },

    // 该歌曲是否已有歌词文件
    songHasLyrics(song) {
        if (!this.lyricsStems || !song || !song.title) return false;
        const stem = song.title
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
        return this.lyricsStems.has(stem);
    },

    async downloadSubtitlesForSong(song) {
        if (!song || !song.source_url) {
            this.showMessage('该内容没有来源链接，无法下载平台字幕，请使用 AI 识别或手动编辑歌词', 'info');
            return;
        }

        const taskKey = 'download';
        this.showTask(taskKey, 'download', `字幕下载：${song.title}`);
        this.updateTask(taskKey, { status: '正在查找作者字幕和自动字幕...', percent: 0 });
        try {
            const lrcPath = await electronAPI.lyrics.download(song.source_url, song.title);
            if (!lrcPath) {
                this.finishTask(taskKey, { success: false, status: '未找到可用字幕' });
                this.showMessage('没有找到可下载的作者字幕或自动字幕，可尝试切换 Medium 后重新 AI 识别', 'info');
                return;
            }
            await this.refreshLyricsStems();
            if (this.currentSong && this.currentSong.id === song.id) {
                await this.loadLyrics(song.title);
                this.updateLyrics();
            }
            this.finishTask(taskKey, { success: true, status: '字幕歌词已保存' });
            this.showMessage('字幕歌词已下载并保存', 'success');
        } catch (error) {
            logger.error('下载字幕失败:', error);
            this.finishTask(taskKey, { success: false, status: '下载字幕失败' });
            this.showMessage('下载字幕失败: ' + error.message, 'error');
        }
    },

    // ==================== AI 音频转歌词（whisper，后台任务模式） ====================

    // 入口：检查工具与模型 → 转后台执行（标题栏徽标显示进度，完成后自动保存，不弹对话框）
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
        const current = status.currentModel || 'small';
        if (!status.models || !status.models[current] || !status.models[current].downloaded) {
            const ready = await this.showWhisperModelManager(true);
            if (!ready) {
                this.showMessage('需要先下载语音识别模型', 'info');
                return;
            }
        }

        // 转后台：任务进面板（进度/取消），不弹任何对话框
        const taskKey = 'transcribe-' + song.id;
        this._lastTranscribeKey = taskKey;
        this.showTask(taskKey, 'transcribe', song.title);

        let result = null;
        try {
            result = await electronAPI.whisper.transcribeSong(song.id);
        } catch (error) {
            logger.error('音频转写失败:', error);
        }

        if (!result) {
            this.finishTask(taskKey, { success: false, status: '识别失败' });
            this.showMessage('识别失败，请重试', 'error');
            return;
        }

        // 模型缺失（可能被删除）→ 引导下载
        if (result.modelMissing) {
            this.finishTask(taskKey, { success: false, status: '模型未下载' });
            const ready = await this.showWhisperModelManager(true);
            if (ready) {
                await this.transcribeSong(song);
            }
            return;
        }

        if (result.cancelled) {
            this.finishTask(taskKey, { success: false, status: '已取消' });
            this.showMessage('已取消识别', 'info');
            return;
        }

        if (!result.success) {
            this.finishTask(taskKey, { success: false, status: (result.error || '识别失败').slice(0, 60) });
            this.showMessage(result.error || '识别失败', 'error');
            return;
        }

        // ⭐ 纯音乐检测：whisper 对无人声音频会输出 [Muziek]/[Music] 等纯标签行
        // 这种结果没有保存价值，明确告知用户而非产出垃圾歌词文件
        const meaningfulLines = this.countMeaningfulLyricLines(result.lrc);
        if (meaningfulLines === 0) {
            this.finishTask(taskKey, { success: false, status: '未识别到人声（纯音乐）' });
            this.showMessage('该音频没有识别到人声歌词（可能是纯音乐/无人声曲目），已跳过保存', 'warning');
            return;
        }

        // 识别成功：直接自动保存为该歌曲的歌词（不弹编辑框打断用户）
        try {
            await electronAPI.lyrics.save(song.title, result.lrc, 'whisper');
            // 若正在播放这首歌，立即加载新歌词
            if (this.currentSong && this.currentSong.id === song.id) {
                await this.loadLyrics(song.title);
            }
            // 刷新"已有歌词"标记
            await this.refreshLyricsStems();
            this.finishTask(taskKey, { success: true, status: `已保存（${meaningfulLines} 行有效歌词）` });
            this.showMessage(`歌词已识别并保存（${meaningfulLines} 行）`, 'success');
        } catch (error) {
            logger.error('保存识别结果失败:', error);
            this.finishTask(taskKey, { success: false, status: '保存失败' });
            this.showMessage('识别成功但保存失败: ' + error.message, 'error');
        }
    },

    // 统计有效歌词行：剥掉时间标签后仍有实际文本（[Muziek]/[Music]/[Applause] 等纯标签视为无效）
    countMeaningfulLyricLines(lrcContent) {
        if (!lrcContent) return 0;
        let count = 0;
        for (const raw of lrcContent.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            // 去掉行首的全部时间标签 [mm:ss.xx]
            const text = line.replace(/^(\[[^\]]*\]\s*)+/, '').trim();
            // 与主进程解析规则一致：剥行首音符（♪）后只剩波浪线/长音符的是哼唱标注，不算歌词
            const stripped = text.replace(/^[♪♫♩♬]/gu, '').replace(/[~～ー\-—\s]/gu, '');
            // 有效 = 有文字内容，且不是环境标签或制作信息（避免保存“作家”等假歌词）。
            if (stripped && !/^\[[^\]]*\]$/.test(text) && !this.isLyricMetadata(text)) {
                count++;
            }
        }
        return count;
    },

    isLyricMetadata(text) {
        const normalized = String(text || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (!normalized) return true;
        if (/^(?:作词|作曲|编曲|演唱|歌手|原唱|制作|制作人|词|曲)\s*[:：]/i.test(normalized)) return true;
        return /^(?:作词|作曲|编曲|演唱|歌手|原唱|制作人?|作者|作家)$/i.test(normalized);
    },

    // ==================== 在线歌词匹配（LRCLIB）/ 智能对齐 / 偏移微调 ====================

    // 匹配 LRCLIB：命中即保存；日文冷门曲大概率无命中（自动落回 AI 识别）
    async matchOnlineLyrics(song) {
        if (!song) return;
        const taskKey = 'match-' + song.id;
        this.showTask(taskKey, 'download', `匹配在线歌词：${song.title.slice(0, 24)}`);
        this.updateTask(taskKey, { status: '正在查询 LRCLIB 歌词库...' });
        try {
            const result = await electronAPI.lyrics.matchOnline(song.id);
            if (!result.success) {
                this.finishTask(taskKey, { success: false, status: result.error.slice(0, 60) });
                this.showMessage(result.error, 'warning');
                return;
            }
            await this.refreshLyricsStems();
            if (this.currentSong && this.currentSong.id === song.id) {
                await this.loadLyrics(song.title);
            }
            const how = result.exact ? '精确匹配' : (result.durationDelta ? `时长差 ${result.durationDelta}s` : '模糊匹配');
            this.finishTask(taskKey, { success: true, status: `已保存（${result.matchedTrack}）` });
            this.showMessage(`已匹配：${result.matchedTrack} - ${result.matchedArtist}（${how}）。若滚动错位，右键选「智能对齐」`, 'success');
            this.renderLyricsPanel();
        } catch (error) {
            logger.error('匹配在线歌词失败:', error);
            this.finishTask(taskKey, { success: false, status: '匹配失败' });
            this.showMessage('匹配在线歌词失败: ' + error.message, 'error');
        }
    },

    // 偏移微调（deltaMs：正=歌词提前显示；写进 LRC 的 [offset:] 标签，可反复调）
    async adjustLyricsOffset(song, deltaMs) {
        if (!song) return;
        try {
            const result = await electronAPI.lyrics.adjustOffset(song.title, deltaMs);
            if (!result.success) {
                this.showMessage(result.error || '调整失败', 'error');
                return;
            }
            if (this.currentSong && this.currentSong.id === song.id) {
                await this.loadLyrics(song.title);
            }
            const sec = (result.offsetMs / 1000).toFixed(1);
            this.showMessage(`歌词偏移 ${result.offsetMs >= 0 ? '+' : ''}${sec}s（提前为正）`, 'info');
        } catch (error) {
            logger.error('调整歌词偏移失败:', error);
            this.showMessage('调整失败: ' + error.message, 'error');
        }
    },

    // 一键获取歌词：LRCLIB 在线库 → 平台字幕 → AI 本地识别（自动降级，命中即停）。
    // 用户不需要关心内部来源差别——都是"给这首歌弄歌词"。
    async fetchLyricsSmart(song) {
        if (!song) return;
        const taskKey = 'fetch-' + song.id;
        this._lastTranscribeKey = taskKey;
        this.showTask(taskKey, 'download', `获取歌词：${song.title.slice(0, 24)}`);

        // 1) LRCLIB 在线歌词库（命中即保存为本地 .lrc；未命中静默降级，任务面板可见进度）
        this.updateTask(taskKey, { status: '1/3 匹配在线歌词库（LRCLIB）...', percent: 8 });
        try {
            const m = await electronAPI.lyrics.matchOnline(song.id);
            if (m && m.success) {
                await this.refreshLyricsStems();
                if (this.currentSong && this.currentSong.id === song.id) {
                    await this.loadLyrics(song.title);
                }
                this.renderLyricsPanel();

                if (m.noTimeline) {
                    // 纯文本无时间轴：自动用本地识别补时间轴（文本保留在线版本，
                    // 只取本地演唱时刻；本地识别不可用时保留纯文本原样）
                    this.updateTask(taskKey, { status: '2/3 为在线歌词添加时间轴（本地快转写比对中）...', percent: 55 });
                    let tsNote = '';
                    try {
                        const a = await electronAPI.lyrics.align(song.id);
                        if (a && a.success) {
                            if (this.currentSong && this.currentSong.id === song.id) {
                                await this.loadLyrics(song.title);
                            }
                            tsNote = `，${a.message || '时间轴已添加'}`;
                        } else {
                            tsNote = '（本地识别不可用，保留纯文本）';
                        }
                    } catch (tsError) {
                        logger.error('添加时间轴失败:', tsError);
                        tsNote = '（本地识别不可用，保留纯文本）';
                    }
                    this.finishTask(taskKey, { success: true, status: `已保存（${m.matchedTrack}）${tsNote}` });
                    this.showMessage(`已匹配在线歌词：${m.matchedTrack} - ${m.matchedArtist}${tsNote}`, 'success');
                    return;
                }

                // 同步歌词：自动校准时间轴（获取流程自带，无需手动）。
                // B站搬运视频常在开头垫几秒画面/轻微变速，时长匹配≠无偏移；
                // 快转写本地前 45s 与歌词句配对算出整体偏移（base 模型约 10 秒）。
                this.updateTask(taskKey, { status: '2/3 校准时间轴（本地快转写比对中，约 10 秒）...', percent: 55 });
                let alignedNote = '';
                try {
                    const a = await electronAPI.lyrics.align(song.id);
                    if (a && a.success) {
                        // 时间轴已被逐句重写，无论整体偏移是否为零都要重载
                        if (this.currentSong && this.currentSong.id === song.id) {
                            await this.loadLyrics(song.title);
                        }
                        alignedNote = `，${a.message || '时间轴已校准'}`;
                    } else {
                        alignedNote = '（自动校准未完成，歌词保持原样）';
                    }
                } catch (alignError) {
                    logger.error('自动校准失败:', alignError);
                    alignedNote = '（自动校准未完成，歌词保持原样）';
                }

                this.finishTask(taskKey, { success: true, status: `已保存（${m.matchedTrack}）${alignedNote}` });
                this.showMessage(`已匹配同步歌词：${m.matchedTrack} - ${m.matchedArtist}${alignedNote}`, 'success');
                return;
            }
        } catch (error) {
            logger.error('LRCLIB 匹配失败:', error);
        }

        // 2) 平台字幕（B站/YouTube 视频自带字幕，非识别）
        if (song.source_url) {
            this.updateTask(taskKey, { status: '2/3 下载平台字幕...', percent: 35 });
            try {
                const lrcPath = await electronAPI.lyrics.download(song.source_url, song.title);
                if (lrcPath) {
                    await this.refreshLyricsStems();
                    if (this.currentSong && this.currentSong.id === song.id) {
                        await this.loadLyrics(song.title);
                        this.updateLyrics();
                    }
                    this.finishTask(taskKey, { success: true, status: '已保存（平台字幕）' });
                    this.showMessage('已从平台字幕获取歌词并保存', 'success');
                    this.renderLyricsPanel();
                    return;
                }
            } catch (error) {
                logger.error('平台字幕下载失败:', error);
            }
        }

        // 3) AI 本地识别（耗时取决于模型与时长，先确认再开跑）
        const goAI = await this.showConfirm({
            title: '改用 AI 识别',
            message: '在线歌词库与平台字幕都没有这首歌。要改用本地 AI 识别吗？速度取决于模型规格与音频长度，可能需要几分钟。',
            confirmText: '开始识别'
        });
        if (!goAI) {
            this.finishTask(taskKey, { success: false, status: '未获取' });
            this._lastTranscribeKey = null;
            return;
        }
        this.finishTask(taskKey, { success: true, status: '转入 AI 识别' });
        await this.transcribeSong(song);
        this._lastTranscribeKey = null;
        this.renderLyricsPanel();
    },

    // ==================== 主窗口歌词面板 ====================

    // 打开/关闭主窗口歌词面板（点击播放栏封面或歌名触发）
    toggleLyricsPanel() {
        const overlay = document.getElementById('lyrics-panel-overlay');
        if (!overlay) return;
        const willShow = overlay.style.display === 'none';
        overlay.style.display = willShow ? 'flex' : 'none';
        if (willShow) {
            this.renderLyricsPanel();
        }
    },

    // 渲染歌词面板：当前行高亮 + 滚动居中；点击行 seek；空态提供获取入口
    renderLyricsPanel() {
        const overlay = document.getElementById('lyrics-panel-overlay');
        const body = document.getElementById('lyrics-panel-body');
        const titleEl = document.getElementById('lyrics-panel-title');
        const offsetEl = document.getElementById('lyrics-panel-offset');
        if (!overlay || overlay.style.display === 'none' || !body) return;

        if (!this.currentSong) {
            titleEl.textContent = '未播放';
            body.innerHTML = '<div class="lyrics-panel-empty"><p>先播放一首歌吧</p></div>';
            return;
        }
        titleEl.textContent = this.currentSong.title;
        // 来源徽章：在线歌词库 / 本地AI识别 / 平台字幕 / 手动录入
        const sourceEl = document.getElementById('lyrics-panel-source');
        if (sourceEl) {
            const labels = { lrclib: '在线歌词库', whisper: '本地AI识别', subtitle: '平台字幕', manual: '手动录入' };
            sourceEl.textContent = labels[this._lyricsSource] || '';
        }
        if (offsetEl) {
            const ms = (this.currentLyrics && this.currentLyrics.length) ? this._lyricsOffsetMs || 0 : 0;
            offsetEl.textContent = ms ? `偏移 ${ms >= 0 ? '+' : ''}${(ms / 1000).toFixed(1)}s` : '';
        }

        const lyrics = this.currentLyrics;
        body.innerHTML = '';
        if (!lyrics || !lyrics.length) {
            const empty = document.createElement('div');
            empty.className = 'lyrics-panel-empty';
            empty.innerHTML = `
                <p>这首歌还没有歌词</p>
                <div class="lyrics-panel-actions">
                    <button class="btn btn-primary" data-role="fetch">一键获取歌词</button>
                    <button class="btn btn-secondary" data-role="edit">手动输入 / 编辑</button>
                </div>
                <p style="font-size: 11.5px; color: var(--text-faint);">自动尝试：在线歌词库 → 平台字幕 → AI 识别</p>`;
            body.appendChild(empty);
            empty.querySelectorAll('[data-role]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const song = this.currentSong;
                    if (btn.dataset.role === 'fetch') {
                        this.fetchLyricsSmart(song);
                    } else {
                        this.showLyricsEditDialog(song, '', '手动输入歌词').then(saved => {
                            if (saved) this.renderLyricsPanel();
                        });
                    }
                });
            });
            return;
        }

        for (let i = 0; i < lyrics.length; i++) {
            const line = lyrics[i];
            const el = document.createElement('div');
            el.className = 'lyrics-line';
            el.dataset.index = String(i);
            el.textContent = line.text;
            if (line.time !== null) {
                el.title = '点击跳转到这句';
                el.addEventListener('click', () => {
                    if (this.audio) {
                        this.audio.currentTime = Math.max(0, line.time);
                        this.updateLyrics();
                    }
                });
            }
            body.appendChild(el);
        }
        this.updateLyricsPanelHighlight(typeof this._currentLyricIndex === 'number' ? this._currentLyricIndex : -1);
    },

    // 同步面板当前行高亮（由 updateLyrics 的 200ms 循环驱动，仅面板打开时生效）
    updateLyricsPanelHighlight(idx) {
        const overlay = document.getElementById('lyrics-panel-overlay');
        if (!overlay || overlay.style.display === 'none') return;
        const body = document.getElementById('lyrics-panel-body');
        if (!body) return;
        const prev = body.querySelector('.lyrics-line.active');
        if (prev) prev.classList.remove('active');
        if (idx < 0) return;
        const cur = body.querySelector(`.lyrics-line[data-index="${idx}"]`);
        if (cur) {
            cur.classList.add('active');
            cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

        const current = status.currentModel || 'small';
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
        let done = 0, successCount = 0, failCount = 0, skippedCount = 0, cancelled = false;

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
            const parts = [`进度：${done} / ${total}（成功 ${successCount}`];
            if (skippedCount > 0) parts.push(`跳过纯音乐 ${skippedCount}`);
            if (failCount > 0) parts.push(`失败 ${failCount}`);
            if (countEl) countEl.textContent = parts.join('，') + '）';
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
                    // 与单曲识别一致：纯音乐（whisper 只输出 [Muziek] 等标签）不保存
                    if (this.countMeaningfulLyricLines(result.lrc) === 0) {
                        skippedCount++;
                    } else {
                        await electronAPI.lyrics.save(song.title, result.lrc, 'whisper');
                        successCount++;
                    }
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
        const skippedNote = skippedCount > 0 ? `，跳过纯音乐 ${skippedCount} 首` : '';
        this.showMessage(cancelled
            ? `已停止：完成 ${successCount} 首，失败 ${failCount} 首${skippedNote}`
            : `批量识别完成：成功 ${successCount} 首${skippedNote}${failCount ? `，失败 ${failCount} 首` : ''}`,
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
                            模型文件较大，<strong>按需选择下载</strong>（默认推荐 Small，歌词准确率更高），随时可删除释放空间。<br>
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

                const createDeleteButton = (model) => {
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
                        if (!confirmed) return;
                        const result = await electronAPI.whisper.deleteModel(model.key);
                        if (result && result.success) {
                            this.showMessage('模型已删除', 'success');
                            renderList();
                        } else {
                            this.showMessage((result && result.error) || '删除模型失败', 'error');
                        }
                    });
                    return delBtn;
                };

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
                        actions.appendChild(createDeleteButton(model));
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
                    await electronAPI.lyrics.save(song.title, text, 'manual');
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
