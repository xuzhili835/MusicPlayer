const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');
const { app } = require('electron');

class ToolsManager {
    constructor() {
        // 应用根目录的bin路径（用于开发环境和打包环境）
        this.appBinDir = app.isPackaged 
            ? path.join(process.resourcesPath, 'bin')
            : path.join(__dirname, 'bin');
        
        // 用户数据目录的bin路径（用于下载的工具）
        const userDataPath = app.getPath('userData');
        this.userBinDir = path.join(userDataPath, 'bin');
        
        this.platform = process.platform;
        this.arch = process.arch;
        
        // 定义工具下载URL和文件名（包含镜像源）
        this.tools = {
            'yt-dlp': {
                windows: {
                    urls: [
                        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
                        'https://ghproxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
                        'https://github.com.cnpmjs.org/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
                    ],
                    filename: 'yt-dlp.exe'
                },
                linux: {
                    urls: [
                        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
                        'https://ghproxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
                    ],
                    filename: 'yt-dlp'
                },
                darwin: {
                    urls: [
                        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
                        'https://ghproxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
                    ],
                    filename: 'yt-dlp'
                }
            },
            'ffmpeg': {
                windows: {
                    urls: [
                        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
                        'https://ghproxy.com/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
                    ],
                    filename: 'ffmpeg.exe',
                    isArchive: true
                },
                linux: {
                    urls: [
                        'https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz'
                    ],
                    filename: 'ffmpeg',
                    isArchive: true
                },
                darwin: {
                    urls: [
                        'https://evermeet.cx/ffmpeg/ffmpeg-5.1.2.zip'
                    ],
                    filename: 'ffmpeg',
                    isArchive: true
                }
            }
        };
        
        console.log('应用bin目录:', this.appBinDir);
        console.log('用户bin目录:', this.userBinDir);
        this.ensureUserBinDir();
    }
    
    // 确保用户bin目录存在
    async ensureUserBinDir() {
        try {
            await fs.mkdir(this.userBinDir, { recursive: true });
        } catch (error) {
            console.error('创建用户工具目录失败:', error);
        }
    }
    
    // 获取工具的完整路径（按优先级查找）
    getToolPath(toolName) {
        const platformKey = this.platform === 'win32' ? 'windows' : 
                           this.platform === 'darwin' ? 'darwin' : 'linux';
        
        if (!this.tools[toolName] || !this.tools[toolName][platformKey]) {
            return null;
        }
        
        const filename = this.tools[toolName][platformKey].filename;
        
        // 返回所有可能的路径，按优先级排序
        return {
            app: path.join(this.appBinDir, filename),      // 应用bin目录（最高优先级）
            user: path.join(this.userBinDir, filename),    // 用户bin目录
            filename: filename
        };
    }
    
    // 获取工具的实际可用路径
    async getAvailableToolPath(toolName) {
        const paths = this.getToolPath(toolName);
        if (!paths) return null;
        
        // 按优先级检查路径
        const pathsToCheck = [
            { type: 'app', path: paths.app },
            { type: 'user', path: paths.user }
        ];
        
        for (const pathInfo of pathsToCheck) {
            try {
                await fs.access(pathInfo.path);
                if (await this.checkFilePermissions(pathInfo.path)) {
                    console.log(`找到 ${toolName} 工具 (${pathInfo.type}): ${pathInfo.path}`);
                    return pathInfo.path;
                }
            } catch (error) {
                // 继续检查下一个路径
            }
        }
        
        return null;
    }
    
    // 检查工具是否存在
    async isToolAvailable(toolName) {
        const toolPath = await this.getAvailableToolPath(toolName);
        return toolPath !== null;
    }
    
    // 检查文件权限
    async checkFilePermissions(filePath) {
        try {
            // 检查读取和执行权限
            await fs.access(filePath, fs.constants.R_OK | fs.constants.X_OK);
            
            // 在Windows上额外检查文件状态
            if (this.platform === 'win32') {
                const stats = await fs.stat(filePath);
                // 检查文件不为空且大小合理
                if (stats.size === 0) {
                    console.warn(`文件大小为0: ${filePath}`);
                    return false;
                }
                if (stats.size > 200 * 1024 * 1024) { // 200MB限制
                    console.warn(`文件大小过大: ${filePath} (${stats.size} bytes)`);
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            console.warn(`权限检查失败: ${filePath} - ${error.message}`);
            return false;
        }
    }
    
    // 检查系统是否已安装工具
    async isSystemToolAvailable(toolName) {
        try {
            const command = this.platform === 'win32' ? 'where' : 'which';
            execSync(`${command} ${toolName}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }
    
    // 下载工具（只下载到用户目录）
    async downloadTool(toolName, onProgress = null) {
        const platformKey = this.platform === 'win32' ? 'windows' : 
                           this.platform === 'darwin' ? 'darwin' : 'linux';
        
        const toolConfig = this.tools[toolName]?.[platformKey];
        if (!toolConfig) {
            throw new Error(`不支持的平台: ${this.platform}`);
        }
        
        const filename = toolConfig.filename;
        const filePath = path.join(this.userBinDir, filename);
        
        // 如果文件已存在，先删除（强制重新下载）
        try {
            await fs.unlink(filePath);
            console.log(`已删除旧的 ${toolName} 文件`);
        } catch (error) {
            // 文件不存在，忽略错误
        }
        
        if (toolConfig.isArchive) {
            // 对于压缩包，先下载到临时文件，然后解压
            const tempPath = path.join(this.userBinDir, `${toolName}_temp.zip`);
            
            // 清理可能存在的临时文件
            try {
                await fs.unlink(tempPath);
            } catch (error) {
                // 忽略
            }
            
            await this.downloadWithRetry(toolConfig.urls, tempPath, onProgress);
            await this.extractTool(tempPath, filePath, toolName);
            await fs.unlink(tempPath); // 删除临时文件
        } else {
            // 直接下载二进制文件
            await this.downloadWithRetry(toolConfig.urls, filePath, onProgress);
        }
        
        // 在Unix系统上设置执行权限
        if (this.platform !== 'win32') {
            execSync(`chmod +x "${filePath}"`);
        }
        
        console.log(`${toolName} 下载完成: ${filePath}`);
        return filePath;
    }
    
    // 带重试机制的下载
    async downloadWithRetry(urls, filePath, onProgress) {
        for (let i = 0; i < urls.length; i++) {
            try {
                console.log(`尝试下载 ${urls[i]}`);
                await this.downloadFile(urls[i], filePath, onProgress);
                return;
            } catch (error) {
                console.warn(`下载失败 ${urls[i]}:`, error.message);
                if (i === urls.length - 1) {
                    throw error;
                }
                console.log(`尝试下一个镜像源...`);
            }
        }
    }
    
    // 下载文件
    async downloadFile(url, filePath, onProgress) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https://') ? https : http;
            
            client.get(url, (response) => {
                // 处理重定向
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return this.downloadFile(response.headers.location, filePath, onProgress)
                        .then(resolve)
                        .catch(reject);
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                
                const fileStream = require('fs').createWriteStream(filePath);
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (onProgress && totalSize) {
                        const progress = (downloadedSize / totalSize) * 100;
                        onProgress(progress, downloadedSize, totalSize);
                    }
                });
                
                response.pipe(fileStream);
                
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                
                fileStream.on('error', reject);
            }).on('error', reject);
        });
    }
    
    // 解压工具
    async extractTool(archivePath, outputPath, toolName) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(archivePath);
        const entries = zip.getEntries();
        
        // 查找可执行文件
        let targetEntry = null;
        for (const entry of entries) {
            if (entry.entryName.includes(toolName) && !entry.isDirectory) {
                targetEntry = entry;
                break;
            }
        }
        
        if (!targetEntry) {
            throw new Error(`在压缩包中未找到 ${toolName} 可执行文件`);
        }
        
        // 提取文件
        const data = zip.readFile(targetEntry);
        await fs.writeFile(outputPath, data);
        
        console.log(`已解压 ${toolName} 到 ${outputPath}`);
    }
    
    // 自动设置工具（下载缺失的工具）
    async setupTools(onProgress = null) {
        const tools = ['yt-dlp', 'ffmpeg'];
        const results = {};
        
        for (const tool of tools) {
            try {
                console.log(`检查工具: ${tool}`);
                
                // 检查应用bin目录
                const paths = this.getToolPath(tool);
                if (paths) {
                    try {
                        await fs.access(paths.app);
                        if (await this.checkFilePermissions(paths.app)) {
                            console.log(`${tool} 在应用bin目录中可用`);
                            results[tool] = 'app';
                            continue;
                        }
                    } catch (error) {
                        // 应用bin目录中没有，继续检查其他位置
                    }
                }
                
                // 检查用户bin目录
                if (await this.isToolAvailable(tool)) {
                    console.log(`${tool} 在用户bin目录中可用`);
                    results[tool] = 'user';
                    continue;
                }
                
                // 检查系统是否有
                if (await this.isSystemToolAvailable(tool)) {
                    console.log(`${tool} 在系统中可用`);
                    results[tool] = 'system';
                    continue;
                }
                
                // 下载工具
                console.log(`下载 ${tool}...`);
                const progressCallback = onProgress ? 
                    (progress, downloaded, total) => onProgress(tool, progress, downloaded, total) : 
                    null;
                
                await this.downloadTool(tool, progressCallback);
                results[tool] = 'downloaded';
                
            } catch (error) {
                console.error(`设置 ${tool} 失败:`, error);
                results[tool] = 'failed';
            }
        }
        
        return results;
    }
    
    // 获取执行命令（优先使用应用bin目录工具，然后使用用户bin目录工具，最后使用系统工具）
    async getExecutableCommand(toolName) {
        try {
            console.log(`正在获取 ${toolName} 的可执行命令...`);
            
            // 1. 优先检查应用bin目录
            const paths = this.getToolPath(toolName);
            if (paths) {
                try {
                    await fs.access(paths.app);
                    if (await this.checkFilePermissions(paths.app)) {
                        console.log(`使用应用bin目录工具: ${paths.app}`);
                        return paths.app;
                    }
                } catch (error) {
                    console.log(`应用bin目录中没有 ${toolName}: ${error.message}`);
                }
            }
            
            // 2. 检查用户bin目录
            const userToolPath = await this.getAvailableToolPath(toolName);
            if (userToolPath) {
                console.log(`使用用户bin目录工具: ${userToolPath}`);
                return userToolPath;
            }
            
            // 3. 检查系统工具
            if (await this.isSystemToolAvailable(toolName)) {
                console.log(`使用系统工具: ${toolName}`);
                return toolName;
            }
            
            console.error(`工具 ${toolName} 完全不可用`);
            return null;
        } catch (error) {
            console.error(`获取 ${toolName} 命令时发生错误:`, error);
            return null;
        }
    }
    
    // 诊断工具状态
    async diagnoseToolStatus(toolName) {
        const diagnosis = {
            toolName,
            appBinDir: this.appBinDir,
            userBinDir: this.userBinDir,
            platform: this.platform,
            issues: [],
            recommendations: []
        };
        
        try {
            // 检查应用bin目录
            try {
                await fs.access(this.appBinDir);
                diagnosis.appBinDirExists = true;
                
                const paths = this.getToolPath(toolName);
                if (paths) {
                    try {
                        await fs.access(paths.app);
                        diagnosis.appToolExists = true;
                        
                        const stats = await fs.stat(paths.app);
                        diagnosis.appToolSize = stats.size;
                        
                        if (stats.size === 0) {
                            diagnosis.issues.push('应用bin目录中的工具文件大小为0');
                        } else if (await this.checkFilePermissions(paths.app)) {
                            diagnosis.appToolUsable = true;
                        } else {
                            diagnosis.issues.push('应用bin目录中的工具无执行权限');
                        }
                    } catch (error) {
                        diagnosis.appToolExists = false;
                        diagnosis.issues.push(`应用bin目录中没有 ${toolName} 工具`);
                    }
                }
            } catch (error) {
                diagnosis.appBinDirExists = false;
                diagnosis.issues.push('应用bin目录不存在');
            }
            
            // 检查用户bin目录
            try {
                await fs.access(this.userBinDir);
                diagnosis.userBinDirExists = true;
            } catch {
                diagnosis.userBinDirExists = false;
                diagnosis.issues.push('用户bin目录不存在');
                diagnosis.recommendations.push('重新运行应用以创建用户bin目录');
            }
            
            // 检查用户bin目录中的工具文件
            const userToolPath = await this.getAvailableToolPath(toolName);
            if (userToolPath) {
                diagnosis.userToolExists = true;
                diagnosis.userToolPath = userToolPath;
                
                try {
                    const stats = await fs.stat(userToolPath);
                    diagnosis.userToolSize = stats.size;
                    
                    if (stats.size === 0) {
                        diagnosis.issues.push('用户bin目录中的工具文件大小为0');
                        diagnosis.recommendations.push('删除损坏的文件并重新下载');
                    } else if (stats.size > 200 * 1024 * 1024) {
                        diagnosis.issues.push('用户bin目录中的工具文件大小异常大');
                        diagnosis.recommendations.push('检查文件是否损坏');
                    }
                    
                    // 检查权限
                    if (await this.checkFilePermissions(userToolPath)) {
                        diagnosis.userToolUsable = true;
                    } else {
                        diagnosis.issues.push('用户bin目录中的工具无执行权限');
                        diagnosis.recommendations.push('检查防病毒软件是否阻止执行');
                    }
                } catch (error) {
                    diagnosis.issues.push(`检查用户bin目录工具时出错: ${error.message}`);
                }
            } else {
                diagnosis.userToolExists = false;
                diagnosis.issues.push('用户bin目录中没有工具');
                diagnosis.recommendations.push('需要下载工具');
            }
            
            // 检查系统工具
            diagnosis.systemToolAvailable = await this.isSystemToolAvailable(toolName);
            
            // 提供综合建议
            if (!diagnosis.appToolUsable && !diagnosis.userToolUsable && !diagnosis.systemToolAvailable) {
                diagnosis.recommendations.push('ffmpeg工具不可用。请打开"检查控制台"并点击"强制重新下载工具"按钮，然后重试。');
            }
            
        } catch (error) {
            diagnosis.issues.push(`诊断过程中发生错误: ${error.message}`);
        }
        
        return diagnosis;
    }
}

module.exports = ToolsManager; 