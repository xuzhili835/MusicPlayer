const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class LyricsManager {
    constructor(lyricsDir = null, tempDir = null) {
        // 如果传入了路径参数则使用，否则使用默认路径（向后兼容）
        this.lyricsDir = lyricsDir || path.join(__dirname, 'lyrics');
        this.tempDir = tempDir || path.join(__dirname, 'temp_downloads');
        this.ensureLyricsDir();
    }

    // 确保歌词目录存在
    async ensureLyricsDir() {
        try {
            await fs.mkdir(this.lyricsDir, { recursive: true });
        } catch (error) {
            console.error('创建歌词目录失败:', error);
        }
    }

    // 获取歌词文件路径
    getLrcPath(songTitle) {
        const cleanTitle = this.cleanFileName(songTitle);
        return path.join(this.lyricsDir, `${cleanTitle}.lrc`);
    }

    // 清理文件名，移除特殊字符
    cleanFileName(fileName) {
        if (!fileName) return 'untitled';
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    // 下载歌词
    async downloadLyrics(videoUrl, songTitle) {
        try {
            console.log(`开始下载歌词: ${songTitle}`);
            
            // 尝试下载字幕
            const subtitlePath = await this.downloadSubtitles(videoUrl, songTitle);
            
            if (!subtitlePath) {
                console.log('没有找到可用的字幕');
                return null;
            }

            // 转换为LRC格式
            const lrcContent = await this.convertToLrc(subtitlePath);
            
            if (!lrcContent) {
                console.log('字幕转换失败');
                return null;
            }

            // 保存LRC文件
            const lrcPath = this.getLrcPath(songTitle);
            await fs.writeFile(lrcPath, lrcContent, 'utf8');
            
            // 清理临时文件
            try {
                await fs.unlink(subtitlePath);
            } catch (error) {
                console.log('清理临时文件失败:', error);
            }

            console.log(`歌词下载完成: ${lrcPath}`);
            return lrcPath;
        } catch (error) {
            console.error('下载歌词失败:', error);
            return null;
        }
    }

    // 下载字幕文件
    async downloadSubtitles(videoUrl, songTitle) {
        try {
            const cleanTitle = this.cleanFileName(songTitle);
            const outputTemplate = path.join(this.tempDir, `${cleanTitle}.%(ext)s`);
            
            // 尝试下载简体中文字幕
            const command = `yt-dlp --write-subs --skip-download --sub-lang zh-Hans --output "${outputTemplate}" "${videoUrl}"`;
            
            console.log('执行命令:', command);
            execSync(command, { stdio: 'pipe' });
            
            // 查找下载的字幕文件
            const possibleExtensions = ['zh-Hans.srt', 'zh-Hans.vtt', 'zh-Hans.ass'];
            
            for (const ext of possibleExtensions) {
                const subtitlePath = path.join(this.tempDir, `${cleanTitle}.${ext}`);
                try {
                    await fs.access(subtitlePath);
                    console.log(`找到字幕文件: ${subtitlePath}`);
                    return subtitlePath;
                } catch (error) {
                    // 文件不存在，继续寻找
                }
            }
            
            // 如果没有找到中文字幕，尝试其他语言
            const fallbackExtensions = ['srt', 'vtt', 'ass'];
            for (const ext of fallbackExtensions) {
                const subtitlePath = path.join(this.tempDir, `${cleanTitle}.${ext}`);
                try {
                    await fs.access(subtitlePath);
                    console.log(`找到字幕文件: ${subtitlePath}`);
                    return subtitlePath;
                } catch (error) {
                    // 文件不存在，继续寻找
                }
            }
            
            return null;
        } catch (error) {
            console.error('下载字幕失败:', error);
            return null;
        }
    }

    // 转换字幕为LRC格式
    async convertToLrc(subtitlePath) {
        try {
            const content = await fs.readFile(subtitlePath, 'utf8');
            const ext = path.extname(subtitlePath).toLowerCase();
            
            switch (ext) {
                case '.srt':
                    return this.convertSrtToLrc(content);
                case '.vtt':
                    return this.convertVttToLrc(content);
                case '.ass':
                    return this.convertAssToLrc(content);
                default:
                    console.log('不支持的字幕格式:', ext);
                    return null;
            }
        } catch (error) {
            console.error('读取字幕文件失败:', error);
            return null;
        }
    }

    // 将SRT格式转换为LRC格式
    convertSrtToLrc(srtContent) {
        try {
            const lines = srtContent.split('\n');
            const lrcLines = [];
            
            let i = 0;
            while (i < lines.length) {
                const line = lines[i].trim();
                
                // 跳过序号行
                if (/^\d+$/.test(line)) {
                    i++;
                    continue;
                }
                
                // 处理时间行
                if (line.includes('-->')) {
                    const timeParts = line.split('-->');
                    if (timeParts.length === 2) {
                        const startTime = this.parseTimeToLrc(timeParts[0].trim());
                        
                        // 收集歌词文本
                        const lyricsText = [];
                        i++;
                        while (i < lines.length && lines[i].trim() !== '' && !/^\d+$/.test(lines[i].trim())) {
                            const text = lines[i].trim();
                            if (text) {
                                lyricsText.push(text);
                            }
                            i++;
                        }
                        
                        if (lyricsText.length > 0) {
                            lrcLines.push(`[${startTime}]${lyricsText.join(' ')}`);
                        }
                    }
                }
                
                i++;
            }
            
            return lrcLines.join('\n');
        } catch (error) {
            console.error('SRT转LRC失败:', error);
            return null;
        }
    }

    // 将VTT格式转换为LRC格式
    convertVttToLrc(vttContent) {
        try {
            const lines = vttContent.split('\n');
            const lrcLines = [];
            
            let i = 0;
            while (i < lines.length) {
                const line = lines[i].trim();
                
                // 跳过WEBVTT标识和其他元数据
                if (line.startsWith('WEBVTT') || line.startsWith('NOTE') || line === '') {
                    i++;
                    continue;
                }
                
                // 处理时间行
                if (line.includes('-->')) {
                    const timeParts = line.split('-->');
                    if (timeParts.length === 2) {
                        const startTime = this.parseTimeToLrc(timeParts[0].trim());
                        
                        // 收集歌词文本
                        const lyricsText = [];
                        i++;
                        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                            const text = lines[i].trim();
                            if (text) {
                                lyricsText.push(text);
                            }
                            i++;
                        }
                        
                        if (lyricsText.length > 0) {
                            lrcLines.push(`[${startTime}]${lyricsText.join(' ')}`);
                        }
                        continue;
                    }
                }
                
                i++;
            }
            
            return lrcLines.join('\n');
        } catch (error) {
            console.error('VTT转LRC失败:', error);
            return null;
        }
    }

    // 将ASS格式转换为LRC格式（简化版）
    convertAssToLrc(assContent) {
        try {
            const lines = assContent.split('\n');
            const lrcLines = [];
            
            for (const line of lines) {
                if (line.startsWith('Dialogue:')) {
                    const parts = line.split(',');
                    if (parts.length >= 10) {
                        const startTime = this.parseAssTimeToLrc(parts[1].trim());
                        const text = parts.slice(9).join(',').trim();
                        
                        if (text) {
                            // 移除ASS格式标签
                            const cleanText = text.replace(/\{[^}]*\}/g, '').trim();
                            if (cleanText) {
                                lrcLines.push(`[${startTime}]${cleanText}`);
                            }
                        }
                    }
                }
            }
            
            return lrcLines.join('\n');
        } catch (error) {
            console.error('ASS转LRC失败:', error);
            return null;
        }
    }

    // 解析时间格式并转换为LRC格式
    parseTimeToLrc(timeStr) {
        try {
            // 移除毫秒部分，只保留到秒
            const time = timeStr.replace(/,\d+$/, '').replace(/\.\d+$/, '');
            const parts = time.split(':');
            
            if (parts.length === 3) {
                const hours = parseInt(parts[0], 10);
                const minutes = parseInt(parts[1], 10) + hours * 60;
                const seconds = parseInt(parts[2], 10);
                
                return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.00`;
            }
            
            return '00:00.00';
        } catch (error) {
            console.error('时间解析失败:', error);
            return '00:00.00';
        }
    }

    // 解析ASS时间格式
    parseAssTimeToLrc(timeStr) {
        try {
            // ASS格式: H:MM:SS.CC
            const parts = timeStr.split(':');
            if (parts.length === 3) {
                const hours = parseInt(parts[0], 10);
                const minutes = parseInt(parts[1], 10) + hours * 60;
                const seconds = parseFloat(parts[2]);
                
                return `${minutes.toString().padStart(2, '0')}:${Math.floor(seconds).toString().padStart(2, '0')}.00`;
            }
            
            return '00:00.00';
        } catch (error) {
            console.error('ASS时间解析失败:', error);
            return '00:00.00';
        }
    }

    // 解析LRC文件
    async parseLrcFile(lrcPath) {
        try {
            const content = await fs.readFile(lrcPath, 'utf8');
            return this.parseLrcContent(content);
        } catch (error) {
            console.error('读取LRC文件失败:', error);
            return null;
        }
    }

    // 解析LRC内容
    parseLrcContent(lrcContent) {
        try {
            const lines = lrcContent.split('\n');
            const lyrics = [];
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;
                
                // 匹配时间标签格式 [mm:ss.xx]
                const timeMatch = trimmedLine.match(/\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
                if (timeMatch) {
                    const minutes = parseInt(timeMatch[1], 10);
                    const seconds = parseInt(timeMatch[2], 10);
                    const centiseconds = parseInt(timeMatch[3], 10);
                    const text = timeMatch[4].trim();
                    
                    const totalSeconds = minutes * 60 + seconds + centiseconds / 100;
                    
                    lyrics.push({
                        time: totalSeconds,
                        text: text
                    });
                }
            }
            
            // 按时间排序
            lyrics.sort((a, b) => a.time - b.time);
            
            return lyrics;
        } catch (error) {
            console.error('解析LRC内容失败:', error);
            return null;
        }
    }

    // 获取当前应该显示的歌词
    getCurrentLyric(lyrics, currentTime) {
        if (!lyrics || lyrics.length === 0) return null;
        
        let currentIndex = -1;
        
        for (let i = 0; i < lyrics.length; i++) {
            if (lyrics[i].time <= currentTime) {
                currentIndex = i;
            } else {
                break;
            }
        }
        
        if (currentIndex >= 0) {
            return {
                index: currentIndex,
                text: lyrics[currentIndex].text,
                time: lyrics[currentIndex].time
            };
        }
        
        return null;
    }

    // 检查歌词文件是否存在
    async lyricsExists(songTitle) {
        try {
            const lrcPath = this.getLrcPath(songTitle);
            await fs.access(lrcPath);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 删除歌词文件
    async deleteLyrics(songTitle) {
        try {
            const lrcPath = this.getLrcPath(songTitle);
            await fs.unlink(lrcPath);
            console.log(`歌词文件已删除: ${lrcPath}`);
            return true;
        } catch (error) {
            console.error('删除歌词文件失败:', error);
            return false;
        }
    }

    // 保存手动编辑的歌词
    async saveLyrics(songTitle, lrcContent) {
        try {
            const lrcPath = this.getLrcPath(songTitle);
            await fs.writeFile(lrcPath, lrcContent, 'utf8');
            console.log(`歌词已保存: ${lrcPath}`);
            return true;
        } catch (error) {
            console.error('保存歌词失败:', error);
            return false;
        }
    }

    // 获取歌词内容
    async getLyrics(songTitle) {
        try {
            const lrcPath = this.getLrcPath(songTitle);
            
            // 检查文件是否存在
            await fs.access(lrcPath);
            
            // 读取歌词文件内容
            const lrcContent = await fs.readFile(lrcPath, 'utf8');
            
            console.log(`歌词已读取: ${songTitle}`);
            return {
                success: true,
                lyrics: lrcContent,
                path: lrcPath
            };
        } catch (error) {
            console.log(`歌词文件不存在: ${songTitle}`);
            return {
                success: false,
                lyrics: null,
                error: '歌词文件不存在'
            };
        }
    }
}

module.exports = LyricsManager; 