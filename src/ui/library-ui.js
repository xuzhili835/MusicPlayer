// 音乐库 / 视图 / 搜索（mixin：挂载到 MusicPlayer.prototype）
// 支持内容分类视图：type-music / type-podcast / type-listening
window.LibraryUI = {
    // 加载全部内容
    async loadMusicLibrary() {
        try {
            const songs = await electronAPI.database.getSongs();
            this.allSongs = songs;
            this.applyViewFilter();

            if (this.playlist.length === 0) {
                this.renderEmptyState(this.getEmptyStateType());
            } else {
                this.hideEmptyState();
            }
        } catch (error) {
            logger.error('加载内容库失败:', error);
            this.showMessage('加载内容库失败', 'error');
        }
    },

    // 根据当前视图过滤播放列表
    applyViewFilter() {
        if (!this.allSongs) this.allSongs = [];
        this.playlist = this.allSongs;
        this.renderSongsList();
        this.updateCurrentViewCount();
    },

    // 视图标题
    getViewTitle() {
        switch (this.currentView) {
            case 'all-songs': return '全部内容';
            case 'recent': return '最近播放';
            default:
                return this.currentPlaylistName || '歌单';
        }
    },

    // 当前空状态类型
    getEmptyStateType() {
        switch (this.currentView) {
            case 'all-songs': return 'library';
            case 'recent': return 'recent';
            default:
                return this.currentView.startsWith('playlist-') ? 'playlist' : 'library';
        }
    },

    // 空状态配置（按视图区分）
    getEmptyStateConfig(type) {
        const configs = {
            library: {
                icon: '🌸',
                title: '还没有内容',
                text: '导入本地文件或下载音源，开始你的聆听之旅',
                slogan: '🌸 声织四季，瓣落成音 🌸',
                actions: true
            },
            recent: {
                icon: '🕒',
                title: '还没有播放历史',
                text: '播放过的内容会出现在这里',
                slogan: '',
                actions: false
            },
            search: {
                icon: '🔍',
                title: '没有找到匹配的结果',
                text: '换个关键词试试',
                slogan: '',
                actions: false
            },
            playlist: {
                icon: '🎵',
                title: '歌单还是空的',
                text: '右键条目并选择"添加到歌单"，把喜欢的内容收进来',
                slogan: '',
                actions: false
            }
        };
        return configs[type] || configs.library;
    },

    // 渲染空状态（每次按需重建内容）
    renderEmptyState(type) {
        const emptyState = document.getElementById('empty-state');
        if (!emptyState) return;

        const config = this.getEmptyStateConfig(type);
        emptyState.innerHTML = `
            <div class="empty-icon">${config.icon}</div>
            <h3>${config.title}</h3>
            <p>${config.text}</p>
            ${config.slogan ? `<div class="empty-slogan">${config.slogan}</div>` : ''}
            ${config.actions ? `
            <div class="empty-actions">
                <button id="empty-download-btn" class="btn btn-primary">下载音源</button>
                <button id="empty-add-files-btn" class="btn btn-secondary">导入本地文件</button>
            </div>` : ''}
        `;
        emptyState.style.display = 'flex';

        const songsContainer = document.querySelector('.songs-container');
        if (songsContainer) songsContainer.style.display = 'none';
    },

    // 隐藏空状态
    hideEmptyState() {
        const emptyState = document.getElementById('empty-state');
        const songsContainer = document.querySelector('.songs-container');
        if (emptyState) emptyState.style.display = 'none';
        if (songsContainer) songsContainer.style.display = 'block';
    },

    renderSongsList() {
        const songsList = document.getElementById('songs-list');
        if (!songsList) return;

        // DocumentFragment 批量插入，避免逐个 appendChild 造成多次重排
        const fragment = document.createDocumentFragment();
        this.playlist.forEach((song, index) => {
            fragment.appendChild(this.createSongItem(song, index));
        });

        songsList.innerHTML = '';
        songsList.appendChild(fragment);

        this.updateCurrentViewCount();
    },

    createSongItem(song, index) {
        const item = dom.createElement('div', {
            className: 'song-item',
            attributes: {
                'data-song-id': song.id,
                'data-id': song.id,
                'data-index': index,
                'role': 'option',
                'tabindex': '0',
                'aria-selected': 'false'
            }
        });

        // 封面（无缩略图时留空底）
        const coverSrc = song.thumbnail ? this.resolveMediaUrl(song.thumbnail) : null;
        item.innerHTML = `
            <div class="song-cover">${coverSrc ? `<img src="${utils.escapeHtml(coverSrc)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
            <div class="song-info-cell">
                <div class="song-title" title="${utils.escapeHtml(song.title)}">${utils.escapeHtml(song.title)}</div>
            </div>
            <div class="song-cell-artist">${utils.escapeHtml(song.artist || '未知艺术家')}</div>
            <div class="song-duration">${utils.formatTime(song.duration)}</div>
        `;

        // 双击播放
        item.addEventListener('dblclick', () => {
            this.playSong(index);
        });

        // 键盘：Enter/Space 播放（无障碍）
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.playSong(index);
            }
        });

        // 右键菜单
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, item);
        });

        return item;
    },

    // 更新当前视图的条目数量显示
    updateCurrentViewCount() {
        const countElement = document.getElementById('current-view-count');
        if (countElement) {
            countElement.textContent = `${this.playlist.length} 项`;
        }
    },

    // ---------- 歌单侧边栏 ----------

    async loadPlaylistsToSidebar() {
        try {
            const playlists = await electronAPI.database.getAllPlaylists();
            const playlistsContainer = document.querySelector('.playlists-container');

            if (!playlistsContainer) return;

            playlistsContainer.innerHTML = '';

            playlists.forEach(playlist => {
                const playlistItem = document.createElement('div');
                playlistItem.className = 'nav-item playlist-item';
                playlistItem.dataset.playlistId = playlist.id;
                playlistItem.innerHTML = `
                    <span class="nav-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="3" rx="1"/>
                            <rect x="3" y="10" width="18" height="3" rx="1"/>
                            <rect x="3" y="16" width="10" height="3" rx="1"/>
                            <circle cx="18" cy="17.5" r="2.5" fill="currentColor"/>
                            <path d="M16 15v5" stroke-width="1.5"/>
                        </svg>
                    </span>
                    <span class="nav-text">${utils.escapeHtml(playlist.name)}</span>
                    <span class="playlist-count">${playlist.song_count || 0}</span>
                `;

                playlistsContainer.appendChild(playlistItem);

                playlistItem.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchToPlaylist(playlist.id, playlist.name);
                });

                playlistItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showPlaylistContextMenu(e, playlist);
                });
            });

        } catch (error) {
            logger.error('加载歌单列表失败:', error);
        }
    },

    async switchToPlaylist(playlistId, playlistName) {
        try {
            this.currentView = `playlist-${playlistId}`;
            this.currentPlaylistId = playlistId;
            this.currentPlaylistName = playlistName;
            this.isSearchResult = false;

            // 更新导航高亮
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.classList.remove('active');
            });

            const currentItem = document.querySelector(`[data-playlist-id="${playlistId}"]`);
            if (currentItem) {
                currentItem.classList.add('active');
            }

            // 加载歌单内容
            const songs = await electronAPI.database.getPlaylistSongs(playlistId);
            this.playlist = songs;

            // 更新界面
            document.getElementById('current-view-title').textContent = playlistName || '歌单';
            this.updateCurrentViewCount();

            this.renderSongsList();

            if (songs.length === 0) {
                this.renderEmptyState('playlist');
            } else {
                this.hideEmptyState();
            }

        } catch (error) {
            logger.error('切换到歌单失败:', error);
            this.showMessage('加载歌单失败', 'error');
        }
    },

    // ---------- 视图切换 ----------

    async switchView(view) {
        this.currentView = view;
        this.currentPlaylistId = null;
        this.currentPlaylistName = null;
        this.isSearchResult = false;

        // 更新导航高亮
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === view) {
                item.classList.add('active');
            }
        });

        try {
            switch (view) {
                case 'recent':
                    await this.loadRecentlyPlayed();
                    break;
                case 'all-songs':
                default:
                    view = 'all-songs';
                    this.currentView = view;
                    await this.loadMusicLibrary();
                    break;
            }

            document.getElementById('current-view-title').textContent = this.getViewTitle();
        } catch (error) {
            logger.error('切换视图失败:', error);
        }
    },

    async loadRecentlyPlayed() {
        try {
            const songs = await electronAPI.database.getRecentlyPlayed(50);
            this.playlist = songs;

            this.renderSongsList();

            if (songs.length === 0) {
                this.renderEmptyState('recent');
            } else {
                this.hideEmptyState();
            }

        } catch (error) {
            logger.error('加载最近播放失败:', error);
            this.showMessage('加载最近播放失败', 'error');
        }
    },

    // ---------- 搜索 ----------

    async handleSearch(query) {
        if (!query.trim()) {
            // 清空搜索：回到当前视图
            await this.refreshCurrentView();
            return;
        }

        try {
            const results = await electronAPI.database.searchSongs(query);
            this.playlist = results;
            this.isSearchResult = true;
            this.renderSongsList();

            const currentViewTitle = document.getElementById('current-view-title');
            if (currentViewTitle) currentViewTitle.textContent = '搜索结果';

            if (results.length === 0) {
                this.renderEmptyState('search');
            } else {
                this.hideEmptyState();
            }

        } catch (error) {
            logger.error('搜索失败:', error);
            this.showMessage('搜索失败', 'error');
        }
    },

    // 刷新当前视图（智能刷新）
    async refreshCurrentView() {
        try {
            // 搜索态：搜索框有内容则重新搜索
            const searchInput = document.getElementById('search-input');
            if (this.isSearchResult && searchInput && searchInput.value.trim()) {
                await this.handleSearch(searchInput.value);
                return;
            }
            this.isSearchResult = false;
            if (searchInput) searchInput.value = '';

            switch (this.currentView) {
                case 'recent':
                    await this.loadRecentlyPlayed();
                    break;
                default:
                    // 歌单视图
                    if (this.currentView.startsWith('playlist-') && this.currentPlaylistId) {
                        await this.switchToPlaylist(this.currentPlaylistId, this.currentPlaylistName);
                    } else {
                        await this.loadMusicLibrary();
                    }
                    break;
            }

            document.getElementById('current-view-title').textContent = this.getViewTitle();
        } catch (error) {
            logger.error('刷新当前视图失败:', error);
        }
    },

    // ---------- 本地文件 ----------

    async selectLocalFiles() {
        try {
            const songs = await electronAPI.file.selectMusic();
            if (songs.length > 0) {
                this.showMessage(`成功添加 ${songs.length} 项内容`, 'success');
                await this.refreshCurrentView();
            }
        } catch (error) {
            logger.error('导入本地文件失败:', error);
            this.showMessage('导入本地文件失败', 'error');
        }
    }
};
