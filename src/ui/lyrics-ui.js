// 歌词加载与桌面歌词同步（mixin：挂载到 MusicPlayer.prototype）
window.LyricsUI = {
    async loadLyrics(songTitle) {
        try {
            const result = await electronAPI.lyrics.get(songTitle);
            // 主进程返回 {success, lyrics: [{time, text}]}，校验为数组再使用
            this.currentLyrics = (result && result.success && Array.isArray(result.lyrics)) ? result.lyrics : null;
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
    }
};
