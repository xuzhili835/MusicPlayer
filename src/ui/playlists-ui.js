// 歌单管理（mixin：挂载到 MusicPlayer.prototype）
window.PlaylistsUI = {
    // ---------- 歌单右键菜单 ----------

    showPlaylistContextMenu(event, playlist) {
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu playlist-context-menu';
        contextMenu.innerHTML = `
            <ul class="context-menu-list">
                <li><a data-action="rename">重命名</a></li>
                <li class="separator"></li>
                <li><a data-action="delete" class="danger">删除歌单</a></li>
            </ul>
        `;

        this.positionContextMenu(contextMenu, event.pageX, event.pageY);

        contextMenu.querySelectorAll('[data-action]').forEach(action => {
            action.addEventListener('click', (e) => {
                e.preventDefault();
                this.handlePlaylistContextAction(action.dataset.action, playlist);
                contextMenu.remove();
            });
        });

        const closeMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    },

    async handlePlaylistContextAction(action, playlist) {
        switch (action) {
            case 'rename':
                await this.renamePlaylist(playlist);
                break;
            case 'delete':
                await this.deletePlaylist(playlist);
                break;
        }
    },

    async renamePlaylist(playlist) {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>重命名歌单</h3>
                    <button class="close-btn" aria-label="关闭">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="rename-playlist-name">歌单名称</label>
                        <input type="text" id="rename-playlist-name" value="${utils.escapeHtml(playlist.name)}" placeholder="请输入新的歌单名称">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-role="cancel">取消</button>
                    <button class="btn btn-primary" id="save-playlist-name-btn">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const nameInput = dialog.querySelector('#rename-playlist-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }

        const closeDialog = () => dialog.remove();
        dialog.querySelector('.close-btn').addEventListener('click', closeDialog);
        dialog.querySelector('[data-role="cancel"]').addEventListener('click', closeDialog);

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
                            this.currentPlaylistName = newName;
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

        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (saveBtn) saveBtn.click();
            } else if (e.key === 'Escape') {
                dialog.remove();
            }
        });
    },

    async exportPlaylist(playlist) {
        // TODO: 实现歌单导出功能
        this.showMessage('歌单导出功能即将推出', 'info');
    },

    async deletePlaylist(playlist) {
        const confirmed = await this.showConfirm({
            title: '删除歌单',
            message: `确定要删除歌单"${playlist.name}"吗？这不会删除音频文件。`,
            confirmText: '删除',
            danger: true
        });

        if (!confirmed) return;

        try {
            await electronAPI.database.removePlaylist(playlist.id);
            this.showMessage('歌单删除成功', 'success');
            await this.loadPlaylistsToSidebar();

            // 如果当前正在查看被删除的歌单，切换到全部内容
            if (this.currentView === `playlist-${playlist.id}`) {
                this.switchView('all-songs');
            }
        } catch (error) {
            logger.error('删除歌单失败:', error);
            this.showMessage('删除失败', 'error');
        }
    },

    // ---------- 创建歌单对话框 ----------

    showCreatePlaylistDialog() {
        const dialog = document.getElementById('playlist-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const nameInput = document.getElementById('playlist-name');
            if (nameInput) {
                nameInput.focus();
            }
        }
    },

    hidePlaylistDialog() {
        const dialog = document.getElementById('playlist-dialog');
        if (dialog) {
            dialog.style.display = 'none';
            const nameInput = document.getElementById('playlist-name');
            if (nameInput) {
                nameInput.value = '';
            }
        }
    },

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

            await this.loadPlaylistsToSidebar();
        } catch (error) {
            logger.error('创建歌单失败:', error);
            this.showMessage('创建歌单失败', 'error');
        }
    },

    // ---------- 添加到歌单 ----------

    async showAddToPlaylistDialog(songId) {
        try {
            const allPlaylists = await electronAPI.database.getAllPlaylists();
            const songPlaylists = await electronAPI.database.getSongPlaylists(songId);
            const songPlaylistIds = songPlaylists.map(p => p.id);

            const dialog = document.createElement('div');
            dialog.className = 'modal-overlay';
            dialog.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>添加到歌单</h3>
                        <button class="close-btn" aria-label="关闭">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="playlist-selection">
                            <div class="create-new-playlist">
                                <input type="text" id="new-playlist-name" placeholder="创建新歌单...">
                                <button id="create-new-playlist-btn">创建</button>
                            </div>
                            <div class="playlist-list">
                                ${allPlaylists.map(playlist => `
                                    <label class="playlist-item ${songPlaylistIds.includes(playlist.id) ? 'disabled' : ''}">
                                        <input type="checkbox" value="${playlist.id}" ${songPlaylistIds.includes(playlist.id) ? 'checked disabled' : ''} />
                                        <span>${utils.escapeHtml(playlist.name)}</span>
                                        <small>${songPlaylistIds.includes(playlist.id) ? '已在歌单中' : ''}</small>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" data-role="cancel">取消</button>
                        <button class="btn btn-primary" id="add-to-playlists-btn">添加</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            const closeDialog = () => dialog.remove();
            dialog.querySelector('.close-btn').addEventListener('click', closeDialog);
            dialog.querySelector('[data-role="cancel"]').addEventListener('click', closeDialog);

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

                    this.showMessage('已创建新歌单并添加', 'success');
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
    },

    // 从当前歌单移除
    async removeFromCurrentPlaylist(songId) {
        if (!this.currentView.startsWith('playlist-')) return;

        const playlistId = parseInt(this.currentView.split('-')[1]);

        const confirmed = await this.showConfirm({
            title: '从歌单移除',
            message: '确定要从当前歌单中移除这个条目吗？',
            confirmText: '移除'
        });

        if (!confirmed) return;

        try {
            await electronAPI.database.removeFromPlaylist(playlistId, songId);
            this.showMessage('已从歌单中移除', 'success');

            await this.switchToPlaylist(playlistId, this.currentPlaylistName);
        } catch (error) {
            logger.error('从歌单移除失败:', error);
            this.showMessage('移除失败', 'error');
        }
    }
};
