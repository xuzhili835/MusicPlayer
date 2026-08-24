// 右键菜单（mixin：挂载到 MusicPlayer.prototype）
window.ContextMenus = {
    // 智能定位右键菜单（防止超出窗口）
    positionContextMenu(menu, x, y) {
        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let finalX = x;
        let finalY = y;

        if (x + menuRect.width > windowWidth) {
            finalX = windowWidth - menuRect.width - 8;
        }

        if (y + menuRect.height > windowHeight) {
            finalY = windowHeight - menuRect.height - 8;
        }

        if (finalX < 8) {
            finalX = 8;
        }

        if (finalY < 8) {
            finalY = 8;
        }

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    },

    // 条目右键菜单
    showContextMenu(event, songItem) {
        event.preventDefault();

        const songId = parseInt(songItem.dataset.id);
        const song = this.playlist.find(s => s.id === songId);

        if (!song) return;

        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        // 已有歌词 → 菜单文案区分，避免无意重复识别
        const hasLyrics = this.songHasLyrics ? this.songHasLyrics(song) : false;
        menu.innerHTML = `
            <div class="menu-item" data-action="play">播放</div>
            <div class="menu-item" data-action="add-to-playlist">添加到歌单</div>
            ${this.currentView.startsWith('playlist-') ? '<div class="menu-item" data-action="remove-from-playlist">从歌单移除</div>' : ''}
            <div class="menu-item" data-action="edit-info">修改信息</div>
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="fetch-lyrics">${hasLyrics ? '重新获取歌词（覆盖当前）' : '获取歌词（自动选最佳来源）'}</div>
            ${hasLyrics ? `
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="lyrics-earlier">歌词慢了 · 提前 0.5 秒</div>
            <div class="menu-item" data-action="lyrics-later">歌词快了 · 延后 0.5 秒</div>` : ''}
            <div class="menu-separator"></div>
            <div class="menu-item" data-action="info">详细信息</div>
            <div class="menu-separator"></div>
            <div class="menu-item danger" data-action="delete">删除</div>
        `;

        this.positionContextMenu(menu, event.pageX, event.pageY);

        this.contextMenuSong = song;

        menu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action) {
                this.handleContextMenuAction(action);
            }
            menu.remove();
        });

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    },

    async handleContextMenuAction(action) {
        if (!this.contextMenuSong) return;

        const song = this.contextMenuSong;

        switch (action) {
            case 'play': {
                const index = this.playlist.findIndex(s => s.id === song.id);
                if (index !== -1) {
                    await this.playSong(index);
                }
                break;
            }
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
            case 'fetch-lyrics':
                await this.fetchLyricsSmart(song);
                break;
            case 'match-online':
                await this.matchOnlineLyrics(song);
                break;
            case 'transcribe':
                await this.transcribeSong(song);
                break;
            case 'download-subtitles':
                await this.downloadSubtitlesForSong(song);
                break;
            // deltaMs 为正 = 歌词提前显示（LRC offset 标准），与菜单文案方向一致
            case 'lyrics-earlier':
                await this.adjustLyricsOffset(song, 500);
                break;
            case 'lyrics-later':
                await this.adjustLyricsOffset(song, -500);
                break;
            case 'delete':
                await this.deleteSong(song.id);
                break;
        }

        this.contextMenuSong = null;
    },

    // ---------- 输入框右键菜单 ----------

    showInputContextMenu(event, inputElement) {
        const existingMenu = document.querySelector('.input-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

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

        this.positionContextMenu(menu, event.pageX, event.pageY);

        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (action) {
                await this.handleInputContextAction(action, inputElement);
            }
            menu.remove();
        });

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    },

    async handleInputContextAction(action, inputElement) {
        try {
            inputElement.focus();

            switch (action) {
                case 'paste':
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        try {
                            if (!document.hasFocus()) {
                                this.showMessage('请先点击窗口以获得焦点', 'warning');
                                return;
                            }
                            const text = await navigator.clipboard.readText();
                            inputElement.value = text;
                            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                        } catch (clipboardError) {
                            console.warn('剪贴板API失败，尝试使用execCommand:', clipboardError);
                            try {
                                document.execCommand('paste');
                            } catch (execError) {
                                this.showMessage('粘贴失败：无法访问剪贴板', 'error');
                            }
                        }
                    } else {
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
                                this.showMessage('剪切失败', 'error');
                            }
                        }
                    } else {
                        try {
                            document.execCommand('cut');
                        } catch (execError) {
                            this.showMessage('剪切失败', 'error');
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
                                this.showMessage('复制失败', 'error');
                            }
                        }
                    } else {
                        try {
                            document.execCommand('copy');
                            this.showMessage('已复制到剪贴板', 'success');
                        } catch (execError) {
                            this.showMessage('复制失败', 'error');
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
};
