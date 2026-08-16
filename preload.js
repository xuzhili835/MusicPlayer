const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 窗口控制
    window: {
        minimize: () => ipcRenderer.invoke('window-minimize'),
        maximize: () => ipcRenderer.invoke('window-maximize'),
        close: () => ipcRenderer.invoke('window-close'),
        openDevTools: () => ipcRenderer.invoke('window-open-dev-tools')
    },

    // 应用信息
    app: {
        getVersion: () => ipcRenderer.invoke('app-get-version')
    },

    // 主题
    theme: {
        set: (theme) => ipcRenderer.invoke('theme-set', theme),
        get: () => ipcRenderer.invoke('theme-get')
    },

    // 更新检查
    updater: {
        check: () => ipcRenderer.invoke('app-check-update'),
        onUpdateAvailable: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('update-available', subscription);
            return () => ipcRenderer.removeListener('update-available', subscription);
        }
    },

    // 数据库操作
    database: {
        getSongs: () => ipcRenderer.invoke('database-get-songs'),
        addSong: (songData) => ipcRenderer.invoke('database-add-song', songData),
        updateSong: (id, updates) => ipcRenderer.invoke('database-update-song', id, updates),
        deleteSong: (id) => ipcRenderer.invoke('database-delete-song', id),
        removeSong: (id) => ipcRenderer.invoke('database-delete-song', id),
        searchSongs: (keyword) => ipcRenderer.invoke('database-search-songs', keyword),
        
        // 歌单操作
        createPlaylist: (name) => ipcRenderer.invoke('database-create-playlist', name),
        updatePlaylist: (id, updates) => ipcRenderer.invoke('database-update-playlist', id, updates),
        removePlaylist: (id) => ipcRenderer.invoke('database-remove-playlist', id),
        getAllPlaylists: () => ipcRenderer.invoke('database-get-all-playlists'),
        addToPlaylist: (playlistId, songId) => ipcRenderer.invoke('database-add-to-playlist', playlistId, songId),
        removeFromPlaylist: (playlistId, songId) => ipcRenderer.invoke('database-remove-from-playlist', playlistId, songId),
        getPlaylistSongs: (playlistId) => ipcRenderer.invoke('database-get-playlist-songs', playlistId),
        isSongInPlaylist: (playlistId, songId) => ipcRenderer.invoke('database-is-song-in-playlist', playlistId, songId),
        getSongPlaylists: (songId) => ipcRenderer.invoke('database-get-song-playlists', songId),
        addSongsToPlaylist: (playlistId, songIds) => ipcRenderer.invoke('database-add-songs-to-playlist', playlistId, songIds),
        
        // 播放历史
        addPlayHistory: (songId) => ipcRenderer.invoke('database-add-play-history', songId),
        getPlayHistory: (limit) => ipcRenderer.invoke('database-get-play-history', limit),
        getRecentlyPlayed: (limit) => ipcRenderer.invoke('database-get-recently-played', limit),
        cleanupPlayHistory: (keepCount) => ipcRenderer.invoke('database-cleanup-play-history', keepCount),
        
        // 设置
        setSetting: (key, value) => ipcRenderer.invoke('database-set-setting', key, value),
        getSetting: (key, defaultValue) => ipcRenderer.invoke('database-get-setting', key, defaultValue),
        getAllSettings: () => ipcRenderer.invoke('database-get-all-settings'),
        deleteSetting: (key) => ipcRenderer.invoke('database-delete-setting', key),
        
        // 统计
        getStats: () => ipcRenderer.invoke('database-get-stats')
    },

    // 文件操作
    file: {
        selectMusic: () => ipcRenderer.invoke('file-select-music'),
        selectCookies: () => ipcRenderer.invoke('file-select-cookies'),
        showInExplorer: (filePath) => ipcRenderer.invoke('file-show-in-explorer', filePath),
        openExternal: (url) => ipcRenderer.invoke('file-open-external', url),
        
        // 文件系统检查和清理
        checkSongsStatus: () => ipcRenderer.invoke('file-check-songs-status'),
        cleanMissingSongs: () => ipcRenderer.invoke('file-clean-missing-songs'),
        checkFileStatus: (filePath) => ipcRenderer.invoke('file-check-status', filePath)
    },

    // 下载功能
    download: {
        bilibiliVideo: (url, options) => ipcRenderer.invoke('download-bilibili-video', url, options),
        media: (url, options) => ipcRenderer.invoke('download-media', url, options),
        getVideoInfo: (url) => ipcRenderer.invoke('download-get-video-info', url),
        cancel: () => ipcRenderer.invoke('download-cancel'),

        // 监听下载进度
        onProgress: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('download-progress', subscription);
            return () => ipcRenderer.removeListener('download-progress', subscription);
        },

        // 监听阶段进度
        onStageProgress: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('download-stage-progress', subscription);
            return () => ipcRenderer.removeListener('download-stage-progress', subscription);
        }
    },

    // 桌面歌词窗口专用（歌词窗口内联脚本使用，走事件而非 invoke）
    desktopLyrics: {
        close: () => ipcRenderer.send('lyrics-window-close'),
        dragStart: (data) => ipcRenderer.send('lyrics-window-drag-start', data),
        dragMove: (data) => ipcRenderer.send('lyrics-window-drag-move', data),
        dragEnd: () => ipcRenderer.send('lyrics-window-drag-end')
    },

    // 隐私模式（老板键）
    privacy: {
        toggle: () => ipcRenderer.invoke('privacy-toggle'),
        getSettings: () => ipcRenderer.invoke('privacy-get-settings'),
        setSettings: (settings) => ipcRenderer.invoke('privacy-set-settings', settings),
        suspendShortcuts: () => ipcRenderer.invoke('privacy-suspend-shortcuts'),
        resumeShortcuts: () => ipcRenderer.invoke('privacy-resume-shortcuts'),

        // 主进程推送的隐私状态变化
        onStateChanged: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('privacy-state-changed', subscription);
            return () => ipcRenderer.removeListener('privacy-state-changed', subscription);
        },

        // 老板键注册失败提示
        onShortcutError: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('privacy-shortcut-error', subscription);
            return () => ipcRenderer.removeListener('privacy-shortcut-error', subscription);
        }
    },


    // 语音识别（音频转歌词，whisper，模型由用户选择下载）
    whisper: {
        getStatus: () => ipcRenderer.invoke('whisper-get-status'),
        downloadModel: (modelKey) => ipcRenderer.invoke('whisper-download-model', modelKey),
        setModel: (modelKey) => ipcRenderer.invoke('whisper-set-model', modelKey),
        deleteModel: (modelKey) => ipcRenderer.invoke('whisper-delete-model', modelKey),
        transcribeSong: (songId) => ipcRenderer.invoke('transcribe-song', songId),

        // 模型下载进度
        onModelProgress: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('whisper-model-progress', subscription);
            return () => ipcRenderer.removeListener('whisper-model-progress', subscription);
        },

        // 转写状态提示
        onTranscribeStatus: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('transcribe-status', subscription);
            return () => ipcRenderer.removeListener('transcribe-status', subscription);
        }
    },
    
    // 工具诊断
    tools: {
        diagnose: (toolName) => ipcRenderer.invoke('tools-diagnose', toolName),
        forceDownload: (toolName) => ipcRenderer.invoke('tools-force-download', toolName),
        checkUpdate: () => ipcRenderer.invoke('tools-check-update'),
        updateYtDlp: () => ipcRenderer.invoke('tools-update-ytdlp')
    },

    // 存储位置
    storage: {
        getInfo: () => ipcRenderer.invoke('storage-get-info'),
        chooseDir: () => ipcRenderer.invoke('storage-choose-dir'),
        migrate: (newDir) => ipcRenderer.invoke('storage-migrate', newDir),
        onMigrateProgress: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('storage-migrate-progress', subscription);
            return () => ipcRenderer.removeListener('storage-migrate-progress', subscription);
        }
    },

    // 歌词功能
    lyrics: {
        get: (songTitle) => ipcRenderer.invoke('lyrics-get', songTitle),
        download: (videoUrl, songTitle) => ipcRenderer.invoke('lyrics-download', videoUrl, songTitle),
        save: (songTitle, lrcContent) => ipcRenderer.invoke('lyrics-save', songTitle, lrcContent),
        getMissing: () => ipcRenderer.invoke('lyrics-get-missing'),

        // 桌面歌词窗口
        toggleWindow: () => ipcRenderer.invoke('lyrics-window-toggle'),
        updateWindow: (text) => ipcRenderer.invoke('lyrics-window-update', text)
    },

    // 音量分析功能
    volume: {
        analyzeSong: (songId, targetLufs) => ipcRenderer.invoke('volume-analyze-song', songId, targetLufs),
        getUnanalyzedSongs: () => ipcRenderer.invoke('volume-get-unanalyzed-songs'),
        getStats: () => ipcRenderer.invoke('volume-get-stats'),
        batchUpdateGains: (newTargetLufs) => ipcRenderer.invoke('volume-batch-update-gains', newTargetLufs)
    }
});

// 工具函数（先定义为本世界变量，内部可互相引用，再暴露到主世界）
const utils = {
    // 时间格式化
    formatTime: (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    },

    // 格式化文件大小
    formatFileSize: (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 格式化字节数（别名）
    formatBytes: (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // URL验证
    isValidUrl: (string) => {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    },

    // B站URL验证
    isBilibiliUrl: (url) => {
        if (!url || typeof url !== 'string') return false;
        const bilibiliPatterns = [
            /^https?:\/\/www\.bilibili\.com\/video\//,
            /^https?:\/\/m\.bilibili\.com\/video\//,
            /^https?:\/\/b23\.tv\//,
            /^https?:\/\/bilibili\.com\/video\//
        ];
        return bilibiliPatterns.some(pattern => pattern.test(url));
    },

    // 从文本中提取B站链接
    extractBilibiliUrl: (text) => {
        if (!text || typeof text !== 'string') return null;

        // 匹配各种B站链接格式
        const patterns = [
            /https?:\/\/www\.bilibili\.com\/video\/[^\s]+/g,
            /https?:\/\/m\.bilibili\.com\/video\/[^\s]+/g,
            /https?:\/\/b23\.tv\/[^\s]+/g,
            /https?:\/\/bilibili\.com\/video\/[^\s]+/g,
            /BV[a-zA-Z0-9]+/g,
            /av\d+/g
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
                let url = matches[0];
                // 如果是BV号或av号，添加完整的URL前缀
                if (url.startsWith('BV') || url.startsWith('av')) {
                    url = `https://www.bilibili.com/video/${url}`;
                }
                return url;
            }
        }

        return null;
    },

    // YouTube URL 验证
    isYouTubeUrl: (url) => {
        if (!url || typeof url !== 'string') return false;
        return /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch|shorts|live)/.test(url) ||
               /^https?:\/\/youtu\.be\//.test(url);
    },

    // 从文本中提取 YouTube 链接
    extractYouTubeUrl: (text) => {
        if (!text || typeof text !== 'string') return null;

        const patterns = [
            /https?:\/\/(www\.|m\.|music\.)?youtube\.com\/watch\?[^\s]+/g,
            /https?:\/\/(www\.|m\.|music\.)?youtube\.com\/shorts\/[^\s]+/g,
            /https?:\/\/(www\.|m\.|music\.)?youtube\.com\/live\/[^\s]+/g,
            /https?:\/\/youtu\.be\/[^\s]+/g
        ];

        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
                return matches[0];
            }
        }

        return null;
    },

    // 通用音源链接提取（B站 或 YouTube）
    extractMediaUrl: (text) => {
        if (!text || typeof text !== 'string') return null;
        return utils.extractBilibiliUrl(text) || utils.extractYouTubeUrl(text);
    },

    // 判断是否为支持的音源链接
    isSupportedMediaUrl: (url) => {
        return utils.isBilibiliUrl(url) || utils.isYouTubeUrl(url);
    },

    // HTML 转义（防止歌曲/歌单元数据注入 XSS）
    escapeHtml: (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    },

    // 清理文件名
    cleanFileName: (fileName) => {
        if (!fileName) return 'untitled';
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    },

    // 防抖函数
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 节流函数
    throttle: (func, limit) => {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // 生成随机ID
    generateId: () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // 深拷贝
    deepClone: (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (obj instanceof Array) return obj.map(item => utils.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = utils.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }
};

contextBridge.exposeInMainWorld('utils', utils);

// 本地存储API
contextBridge.exposeInMainWorld('storage', {
    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    },
    
    get: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    },
    
    remove: (key) => {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    },
    
    clear: () => {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }
});

// 日志系统
contextBridge.exposeInMainWorld('logger', {
    info: (message, ...args) => {
        console.log(`[INFO] ${message}`, ...args);
    },
    
    warn: (message, ...args) => {
        console.warn(`[WARN] ${message}`, ...args);
    },
    
    error: (message, ...args) => {
        console.error(`[ERROR] ${message}`, ...args);
    },
    
    debug: (message, ...args) => {
        if (process.env.NODE_ENV === 'development') {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    }
});

// 事件管理器
contextBridge.exposeInMainWorld('eventManager', {
    listeners: new Map(),
    
    on: function(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        
        return () => this.off(event, callback);
    },
    
    off: function(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    },
    
    emit: function(event, ...args) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error('Event callback error:', error);
                }
            });
        }
    },
    
    clear: function(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
});

// DOM工具
contextBridge.exposeInMainWorld('dom', {
    ready: (callback) => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    },
    
    createElement: (tag, options = {}) => {
        const element = document.createElement(tag);
        
        if (options.className) {
            element.className = options.className;
        }
        
        if (options.id) {
            element.id = options.id;
        }
        
        if (options.textContent) {
            element.textContent = options.textContent;
        }
        
        if (options.innerHTML) {
            element.innerHTML = options.innerHTML;
        }
        
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });
        }
        
        if (options.styles) {
            Object.entries(options.styles).forEach(([key, value]) => {
                element.style[key] = value;
            });
        }
        
        if (options.events) {
            Object.entries(options.events).forEach(([event, handler]) => {
                element.addEventListener(event, handler);
            });
        }
        
        return element;
    },
    
    addClass: (element, className) => {
        if (element && className) {
            element.classList.add(className);
        }
    },
    
    removeClass: (element, className) => {
        if (element && className) {
            element.classList.remove(className);
        }
    },
    
    toggleClass: (element, className) => {
        if (element && className) {
            element.classList.toggle(className);
        }
    },
    
    hasClass: (element, className) => {
        return element && className && element.classList.contains(className);
    }
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

console.log('Preload script loaded successfully');
