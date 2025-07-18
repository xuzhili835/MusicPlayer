const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { app } = require('electron');

class Database {
    constructor() {
        this.db = null;
        // 在打包应用中，将数据库放在用户数据目录
        const userDataPath = app ? app.getPath('userData') : __dirname;
        this.dbPath = path.join(userDataPath, 'music.db');
        this.isInitialized = false;
        this.wasRebuilt = false; // 标记数据库是否被重建
        
        console.log('数据库路径:', this.dbPath);
    }

    // 初始化数据库
    async initialize() {
        try {
            // 确保用户数据目录存在
            const userDataPath = path.dirname(this.dbPath);
            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true });
            }

            // 如果数据库文件不存在且是打包应用，尝试从应用目录复制初始数据库
            if (!fs.existsSync(this.dbPath)) {
                await this.createInitialDatabase();
            }

            // 创建数据库连接
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('数据库连接失败:', err);
                    throw err;
                }
                console.log('数据库连接成功');
            });

            // 先运行数据库迁移
            await this.runMigrations();
            
            // 创建表结构（如果不存在）
            await this.createTables();
            
            // 只有在没有重建数据库的情况下才清理无效数据
            if (!this.wasRebuilt) {
                await this.cleanupInvalidData();
            }
            
            this.isInitialized = true;
            console.log('数据库初始化完成');
        } catch (error) {
            console.error('数据库初始化失败:', error);
            throw error;
        }
    }

    // 创建初始数据库或复制现有数据库
    async createInitialDatabase() {
        try {
            // 检查应用目录中是否有现有的数据库文件
            const appDbPath = path.join(__dirname, 'music.db');
            
            if (fs.existsSync(appDbPath)) {
                // 复制现有数据库到用户数据目录
                console.log('复制现有数据库到用户数据目录...');
                fs.copyFileSync(appDbPath, this.dbPath);
                console.log('数据库复制完成');
            } else {
                console.log('将创建新的数据库文件');
            }
        } catch (error) {
            console.log('无法复制现有数据库，将创建新的数据库文件:', error.message);
        }
    }

    // 运行数据库迁移
    async runMigrations() {
        try {
            console.log('开始数据库迁移...');
            
            // 检查表是否存在和结构是否正确
            const tablesExist = await this.checkTablesExist();
            
            if (!tablesExist) {
                console.log('数据库表不存在，将通过 createTables 创建');
                return;
            }
            
            // 检查 songs 表结构
            try {
                const tableInfo = await this.query("PRAGMA table_info(songs)");
                const hasAddedAt = tableInfo.some(column => column.name === 'added_at');
                
                if (!hasAddedAt) {
                    console.log('检测到旧的表结构，重建数据库...');
                    await this.rebuildDatabase();
                    return;
                }
                
                console.log('数据库表结构正确，无需迁移');
            } catch (error) {
                console.log('检查表结构失败，重建数据库:', error.message);
                await this.rebuildDatabase();
            }
            
        } catch (error) {
            console.error('数据库迁移失败:', error);
            // 如果迁移失败，尝试重建数据库
            try {
                console.log('迁移失败，尝试重建数据库...');
                await this.rebuildDatabase();
            } catch (rebuildError) {
                console.error('重建数据库也失败了:', rebuildError);
            }
        }
    }

    // 检查表是否存在
    async checkTablesExist() {
        try {
            const tables = await this.query(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name IN ('songs', 'playlists', 'playlist_songs', 'play_history', 'settings')
            `);
            return tables.length === 5;
        } catch (error) {
            console.log('检查表存在性失败:', error.message);
            return false;
        }
    }

    // 重建数据库
    async rebuildDatabase() {
        try {
            console.log('开始重建数据库...');
            
            // 备份有效的歌曲数据（如果有的话）
            let backupSongs = [];
            try {
                backupSongs = await this.query('SELECT * FROM songs');
                console.log(`备份了 ${backupSongs.length} 首歌曲记录`);
            } catch (error) {
                console.log('无法备份歌曲数据，将从空数据库开始');
            }
            
            // 删除所有表
            const dropTables = [
                'DROP TABLE IF EXISTS play_history',
                'DROP TABLE IF EXISTS playlist_songs', 
                'DROP TABLE IF EXISTS playlists',
                'DROP TABLE IF EXISTS songs',
                'DROP TABLE IF EXISTS settings'
            ];
            
            for (const sql of dropTables) {
                try {
                    await this.run(sql);
                } catch (error) {
                    console.log(`删除表失败: ${sql}`, error.message);
                }
            }
            
            console.log('旧表删除完成，重新创建表结构...');
            
            // 重新创建表结构（这里会调用 createTables）
            await this.createTables();
            
            // 恢复有效的歌曲数据
            if (backupSongs.length > 0) {
                console.log('开始恢复歌曲数据...');
                let restoredCount = 0;
                
                for (const song of backupSongs) {
                    try {
                        // 检查文件是否仍然存在
                        if (fs.existsSync(song.path)) {
                            await this.run(
                                'INSERT INTO songs (title, artist, duration, path, source_url, thumbnail, video_path, play_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                [
                                    song.title, 
                                    song.artist || '', 
                                    song.duration || 0, 
                                    song.path, 
                                    song.source_url || null, 
                                    song.thumbnail || null,
                                    song.video_path || null,
                                    song.play_count || 0
                                ]
                            );
                            restoredCount++;
                        } else {
                            console.log(`跳过不存在的文件: ${song.path}`);
                        }
                    } catch (error) {
                        console.log(`恢复歌曲失败: ${song.title}`, error.message);
                    }
                }
                
                console.log(`恢复了 ${restoredCount} 首有效歌曲`);
            }
            
            console.log('数据库重建完成');
            this.wasRebuilt = true; // 标记数据库已被重建
            
        } catch (error) {
            console.error('数据库重建失败:', error);
            throw error;
        }
    }

    // 清理无效数据
    async cleanupInvalidData() {
        try {
            console.log('开始清理无效数据...');
            
            // 获取所有歌曲记录
            const songs = await this.query('SELECT id, path, title FROM songs');
            const toDelete = [];
            
            for (const song of songs) {
                // 检查文件是否存在
                if (!fs.existsSync(song.path)) {
                    toDelete.push(song.id);
                    console.log(`发现无效歌曲记录: ${song.title} (文件不存在: ${song.path})`);
                }
            }
            
            if (toDelete.length > 0) {
                const placeholders = toDelete.map(() => '?').join(',');
                await this.run(`DELETE FROM songs WHERE id IN (${placeholders})`, toDelete);
                console.log(`清理了 ${toDelete.length} 个无效歌曲记录`);
            }
            
            console.log('无效数据清理完成');
        } catch (error) {
            console.error('清理无效数据失败:', error);
            // 继续执行，不阻止应用启动
        }
    }

    // 创建表结构
    async createTables() {
        const createTablesSQL = `
            -- 歌曲表
            CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                artist TEXT,
                duration INTEGER,
                path TEXT UNIQUE NOT NULL,
                source_url TEXT,
                thumbnail TEXT,
                video_path TEXT,
                play_count INTEGER DEFAULT 0,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 歌单表
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 歌单歌曲关联表
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER,
                song_id INTEGER,
                order_index INTEGER,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                PRIMARY KEY (playlist_id, song_id)
            );

            -- 播放历史表
            CREATE TABLE IF NOT EXISTS play_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                song_id INTEGER,
                played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
            );

            -- 设置表
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 创建索引
            CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
            CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
            CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);
            CREATE INDEX IF NOT EXISTS idx_play_history_song ON play_history(song_id);
            CREATE INDEX IF NOT EXISTS idx_play_history_date ON play_history(played_at);
        `;

        return new Promise((resolve, reject) => {
            this.db.exec(createTablesSQL, (err) => {
                if (err) {
                    console.error('创建表失败:', err);
                    reject(err);
                } else {
                    console.log('数据库表创建成功');
                    resolve();
                }
            });
        });
    }

    // 通用查询方法
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('查询失败:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // 通用执行方法
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('执行失败:', err);
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // 添加歌曲
    async addSong(songData) {
        try {
            const { title, artist, duration, path, source_url, thumbnail } = songData;
            
            const result = await this.run(
                'INSERT INTO songs (title, artist, duration, path, source_url, thumbnail) VALUES (?, ?, ?, ?, ?, ?)',
                [title, artist || '', duration || 0, path, source_url || null, thumbnail || null]
            );
            
            return result.lastID;
        } catch (error) {
            console.error('添加歌曲失败:', error);
            throw error;
        }
    }

    // 获取所有歌曲
    async getAllSongs() {
        try {
            const songs = await this.query('SELECT * FROM songs ORDER BY added_at DESC');
            return songs;
        } catch (error) {
            console.error('获取所有歌曲失败:', error);
            throw error;
        }
    }

    // 根据ID获取歌曲
    async getSongById(id) {
        try {
            const songs = await this.query('SELECT * FROM songs WHERE id = ?', [id]);
            return songs[0] || null;
        } catch (error) {
            console.error('获取歌曲失败:', error);
            throw error;
        }
    }

    // 更新歌曲信息
    async updateSong(id, updates) {
        try {
            const fields = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }

            if (fields.length === 0) {
                throw new Error('没有要更新的字段');
            }

            values.push(id);

            const result = await this.run(
                `UPDATE songs SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            return result.changes > 0;
        } catch (error) {
            console.error('更新歌曲失败:', error);
            throw error;
        }
    }

    // 删除歌曲
    async removeSong(id) {
        try {
            // 先从所有歌单中移除
            await this.run('DELETE FROM playlist_songs WHERE song_id = ?', [id]);
            
            // 然后删除歌曲
            const result = await this.run('DELETE FROM songs WHERE id = ?', [id]);
            
            return result.changes > 0;
        } catch (error) {
            console.error('删除歌曲失败:', error);
            throw error;
        }
    }

    // 搜索歌曲
    async searchSongs(keyword) {
        try {
            const songs = await this.query(
                'SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? ORDER BY title ASC',
                [`%${keyword}%`, `%${keyword}%`]
            );
            return songs;
        } catch (error) {
            console.error('搜索歌曲失败:', error);
            throw error;
        }
    }

    // 创建歌单
    async createPlaylist(name) {
        try {
            const result = await this.run(
                'INSERT INTO playlists (name) VALUES (?)',
                [name]
            );
            return result.lastID;
        } catch (error) {
            console.error('创建歌单失败:', error);
            throw error;
        }
    }

    // 更新歌单信息
    async updatePlaylist(id, updates) {
        try {
            const fields = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }

            if (fields.length === 0) {
                throw new Error('没有要更新的字段');
            }

            values.push(id);

            const result = await this.run(
                `UPDATE playlists SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            return result.changes > 0;
        } catch (error) {
            console.error('更新歌单失败:', error);
            throw error;
        }
    }

    // 获取所有歌单
    async getAllPlaylists() {
        try {
            const playlists = await this.query(`
                SELECT p.*, COUNT(ps.song_id) as song_count 
                FROM playlists p 
                LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id 
                GROUP BY p.id 
                ORDER BY p.created_at DESC
            `);
            return playlists;
        } catch (error) {
            console.error('获取所有歌单失败:', error);
            throw error;
        }
    }

    // 删除歌单
    async removePlaylist(id) {
        try {
            // 先删除关联关系
            await this.run('DELETE FROM playlist_songs WHERE playlist_id = ?', [id]);
            
            // 然后删除歌单
            const result = await this.run('DELETE FROM playlists WHERE id = ?', [id]);
            
            return result.changes > 0;
        } catch (error) {
            console.error('删除歌单失败:', error);
            throw error;
        }
    }

    // 添加歌曲到歌单
    async addToPlaylist(playlistId, songId) {
        try {
            // 获取当前歌单中的歌曲数量作为order_index
            const countResult = await this.query(
                'SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = ?',
                [playlistId]
            );
            
            const orderIndex = countResult[0].count;
            
            const result = await this.run(
                'INSERT INTO playlist_songs (playlist_id, song_id, order_index) VALUES (?, ?, ?)',
                [playlistId, songId, orderIndex]
            );
            
            return result.changes > 0;
        } catch (error) {
            console.error('添加歌曲到歌单失败:', error);
            throw error;
        }
    }

    // 从歌单中移除歌曲
    async removeFromPlaylist(playlistId, songId) {
        try {
            const result = await this.run(
                'DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?',
                [playlistId, songId]
            );
            
            return result.changes > 0;
        } catch (error) {
            console.error('从歌单移除歌曲失败:', error);
            throw error;
        }
    }

    // 获取歌单中的歌曲
    async getPlaylistSongs(playlistId) {
        try {
            const songs = await this.query(`
                SELECT s.*, ps.order_index, ps.added_at as playlist_added_at
                FROM songs s
                INNER JOIN playlist_songs ps ON s.id = ps.song_id
                WHERE ps.playlist_id = ?
                ORDER BY ps.order_index ASC
            `, [playlistId]);
            
            return songs;
        } catch (error) {
            console.error('获取歌单歌曲失败:', error);
            throw error;
        }
    }

    // 检查歌曲是否在歌单中
    async isSongInPlaylist(playlistId, songId) {
        try {
            const result = await this.query(
                'SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = ? AND song_id = ?',
                [playlistId, songId]
            );
            return result[0].count > 0;
        } catch (error) {
            console.error('检查歌曲是否在歌单中失败:', error);
            throw error;
        }
    }

    // 获取歌曲所在的歌单
    async getSongPlaylists(songId) {
        try {
            const playlists = await this.query(`
                SELECT p.id, p.name, p.created_at
                FROM playlists p
                INNER JOIN playlist_songs ps ON p.id = ps.playlist_id
                WHERE ps.song_id = ?
                ORDER BY p.name ASC
            `, [songId]);
            
            return playlists;
        } catch (error) {
            console.error('获取歌曲所在歌单失败:', error);
            throw error;
        }
    }

    // 批量添加歌曲到歌单
    async addSongsToPlaylist(playlistId, songIds) {
        try {
            const db = this.db;
            
            // 获取当前歌单中的歌曲数量作为起始order_index
            const countResult = await this.query(
                'SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = ?',
                [playlistId]
            );
            
            let orderIndex = countResult[0].count;
            
            return new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    let completed = 0;
                    let hasError = false;
                    
                    songIds.forEach(songId => {
                        if (hasError) return;
                        
                        db.run(
                            'INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, order_index) VALUES (?, ?, ?)',
                            [playlistId, songId, orderIndex++],
                            function(err) {
                                if (err) {
                                    hasError = true;
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }
                                
                                completed++;
                                if (completed === songIds.length) {
                                    db.run('COMMIT');
                                    resolve(true);
                                }
                            }
                        );
                    });
                });
            });
        } catch (error) {
            console.error('批量添加歌曲到歌单失败:', error);
            throw error;
        }
    }

    // 更新歌单中歌曲的顺序
    async updatePlaylistOrder(playlistId, songOrders) {
        try {
            const db = this.db;
            
            return new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    let completed = 0;
                    let hasError = false;
                    
                    songOrders.forEach(({ songId, orderIndex }) => {
                        if (hasError) return;
                        
                        db.run(
                            'UPDATE playlist_songs SET order_index = ? WHERE playlist_id = ? AND song_id = ?',
                            [orderIndex, playlistId, songId],
                            function(err) {
                                if (err) {
                                    hasError = true;
                                    db.run('ROLLBACK');
                                    reject(err);
                                    return;
                                }
                                
                                completed++;
                                if (completed === songOrders.length) {
                                    db.run('COMMIT');
                                    resolve(true);
                                }
                            }
                        );
                    });
                });
            });
        } catch (error) {
            console.error('更新歌单顺序失败:', error);
            throw error;
        }
    }

    // 获取数据库统计信息
    async getStats() {
        try {
            const songCount = await this.query('SELECT COUNT(*) as count FROM songs');
            const playlistCount = await this.query('SELECT COUNT(*) as count FROM playlists');
            const totalDuration = await this.query('SELECT SUM(duration) as total FROM songs');
            
            return {
                songCount: songCount[0].count,
                playlistCount: playlistCount[0].count,
                totalDuration: totalDuration[0].total || 0
            };
        } catch (error) {
            console.error('获取统计信息失败:', error);
            throw error;
        }
    }

    // 清理数据库（移除不存在的文件）
    async cleanup() {
        try {
            const songs = await this.query('SELECT id, path FROM songs');
            const toDelete = [];
            
            for (const song of songs) {
                if (!fs.existsSync(song.path)) {
                    toDelete.push(song.id);
                }
            }
            
            if (toDelete.length > 0) {
                const placeholders = toDelete.map(() => '?').join(',');
                await this.run(`DELETE FROM songs WHERE id IN (${placeholders})`, toDelete);
                console.log(`清理了 ${toDelete.length} 个不存在的音乐文件`);
            }
            
            return toDelete.length;
        } catch (error) {
            console.error('数据库清理失败:', error);
            throw error;
        }
    }

    // ==================== 播放历史功能 ====================

    // 添加播放记录
    async addPlayHistory(songId) {
        try {
            // 添加播放记录
            await this.run(
                'INSERT INTO play_history (song_id) VALUES (?)',
                [songId]
            );
            
            // 更新歌曲播放次数
            await this.run(
                'UPDATE songs SET play_count = play_count + 1 WHERE id = ?',
                [songId]
            );
            
            return true;
        } catch (error) {
            console.error('添加播放历史失败:', error);
            throw error;
        }
    }

    // 获取播放历史
    async getPlayHistory(limit = 100) {
        try {
            const history = await this.query(`
                SELECT s.*, ph.played_at 
                FROM songs s
                INNER JOIN play_history ph ON s.id = ph.song_id
                ORDER BY ph.played_at DESC
                LIMIT ?
            `, [limit]);
            
            return history;
        } catch (error) {
            console.error('获取播放历史失败:', error);
            throw error;
        }
    }

    // 获取最近播放的歌曲（去重）
    async getRecentlyPlayed(limit = 50) {
        try {
            const songs = await this.query(`
                SELECT s.*, MAX(ph.played_at) as last_played
                FROM songs s
                INNER JOIN play_history ph ON s.id = ph.song_id
                GROUP BY s.id
                ORDER BY last_played DESC
                LIMIT ?
            `, [limit]);
            
            return songs;
        } catch (error) {
            console.error('获取最近播放失败:', error);
            throw error;
        }
    }

    // 清理播放历史
    async cleanupPlayHistory(keepCount = 1000) {
        try {
            // 保留最近的播放记录
            const result = await this.run(`
                DELETE FROM play_history 
                WHERE id NOT IN (
                    SELECT id FROM play_history 
                    ORDER BY played_at DESC 
                    LIMIT ?
                )
            `, [keepCount]);
            
            return result.changes;
        } catch (error) {
            console.error('清理播放历史失败:', error);
            throw error;
        }
    }

    // ==================== 设置管理 ====================

    // 保存设置
    async setSetting(key, value) {
        try {
            const result = await this.run(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                [key, JSON.stringify(value)]
            );
            return result.changes > 0;
        } catch (error) {
            console.error('保存设置失败:', error);
            throw error;
        }
    }

    // 获取设置
    async getSetting(key, defaultValue = null) {
        try {
            const result = await this.query(
                'SELECT value FROM settings WHERE key = ?',
                [key]
            );
            
            if (result && result.length > 0 && result[0] && result[0].value !== undefined) {
                try {
                    return JSON.parse(result[0].value);
                } catch (parseError) {
                    console.warn('设置值解析失败，返回原始值:', key, parseError);
                    return result[0].value;
                }
            }
            return defaultValue;
        } catch (error) {
            console.error('获取设置失败:', error);
            return defaultValue;
        }
    }

    // 获取所有设置
    async getAllSettings() {
        try {
            const settings = await this.query('SELECT key, value FROM settings');
            const result = {};
            
            settings.forEach(setting => {
                try {
                    result[setting.key] = JSON.parse(setting.value);
                } catch (e) {
                    result[setting.key] = setting.value;
                }
            });
            
            return result;
        } catch (error) {
            console.error('获取所有设置失败:', error);
            throw error;
        }
    }

    // 删除设置
    async deleteSetting(key) {
        try {
            const result = await this.run(
                'DELETE FROM settings WHERE key = ?',
                [key]
            );
            return result.changes > 0;
        } catch (error) {
            console.error('删除设置失败:', error);
            throw error;
        }
    }

    // 关闭数据库连接
    async close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('关闭数据库失败:', err);
                        reject(err);
                    } else {
                        console.log('数据库连接已关闭');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
