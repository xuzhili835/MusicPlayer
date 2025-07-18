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
        getVideoInfo: (url) => ipcRenderer.invoke('download-get-video-info', url),
        
        // 监听下载进度
        onProgress: (callback) => {
            const subscription = (event, data) => callback(data);
            ipcRenderer.on('download-progress', subscription);
            return () => ipcRenderer.removeListener('download-progress', subscription);
        }
    },
    
    // 工具诊断
    tools: {
        diagnose: (toolName) => ipcRenderer.invoke('tools-diagnose', toolName),
        forceDownload: (toolName) => ipcRenderer.invoke('tools-force-download', toolName)
    },

    // 歌词功能
    lyrics: {
        get: (songTitle) => ipcRenderer.invoke('lyrics-get', songTitle),
        download: (videoUrl, songTitle) => ipcRenderer.invoke('lyrics-download', videoUrl, songTitle),
        save: (songTitle, lrcContent) => ipcRenderer.invoke('lyrics-save', songTitle, lrcContent),
        
        // 桌面歌词窗口
        toggleWindow: () => ipcRenderer.invoke('lyrics-window-toggle'),
        updateWindow: (text) => ipcRenderer.invoke('lyrics-window-update', text)
    }
});

// 工具函数
contextBridge.exposeInMainWorld('utils', {
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
});

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
