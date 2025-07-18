// SVG图标库 - Sakura Echo 音乐播放器
const icons = {
    // Sakura Echo 主应用Logo - 樱花音符组合
    sakuraLogo: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <!-- 音符主体 -->
        <path d="M9 18V5l12-2v13" stroke="#667eea" stroke-width="1.5"/>
        <circle cx="6" cy="18" r="3" fill="#667eea" stroke="#667eea"/>
        <circle cx="18" cy="16" r="3" fill="#667eea" stroke="#667eea"/>
        
        <!-- 樱花花瓣装饰 -->
        <g opacity="0.7">
            <!-- 花瓣1 -->
            <path d="M3 12c1-1.5 2.5-1.5 3 0s-0.5 2.5-2 2-2-2-1-0.5z" fill="#ffb3d1" stroke="#ff8fb3" stroke-width="0.5"/>
            <!-- 花瓣2 -->
            <path d="M21 8c1-1.5 2.5-1.5 3 0s-0.5 2.5-2 2-2-2-1-0.5z" fill="#ffb3d1" stroke="#ff8fb3" stroke-width="0.5"/>
            <!-- 花瓣3 -->
            <path d="M12 3c1.5-1 1.5-2.5 0-3s-2.5 0.5-2 2 2 2 0.5 1z" fill="#ffc4e1" stroke="#ffaad4" stroke-width="0.5"/>
        </g>
    </svg>`,
    
    // 樱花装饰图标 - 用于导航和装饰
    sakuraBlossom: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <g opacity="0.8">
            <!-- 花瓣1 -->
            <path d="M8 2c1-1 2-0.5 2 0.5s-1 1.5-2 1-1-1.5 0-1.5z" fill="#ffb3d1"/>
            <!-- 花瓣2 -->
            <path d="M12 6c1-1 1.5 0 0.5 1s-1.5 1-1-2z" fill="#ffc4e1"/>
            <!-- 花瓣3 -->
            <path d="M10 12c1 1 0.5 2-0.5 2s-1.5-1-1-2 1.5-1 2 0z" fill="#ffb3d1"/>
            <!-- 花瓣4 -->
            <path d="M4 10c-1 1-1.5 0-0.5-1s1.5-1 1 2z" fill="#ffc4e1"/>
            <!-- 花瓣5 -->
            <path d="M6 4c-1-1-0.5-2 0.5-2s1.5 1 1 2-1.5 1-2 0z" fill="#ffb3d1"/>
            <!-- 花心 -->
            <circle cx="8" cy="8" r="1.5" fill="#ffaad4"/>
        </g>
    </svg>`,
    
    // 音乐相关图标
    music: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
    </svg>`,
    
    // 播放控制图标
    play: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
    </svg>`,
    
    pause: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
    </svg>`,
    
    previous: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
    </svg>`,
    
    next: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
    </svg>`,
    
    shuffle: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16,3 21,3 21,8"/>
        <path d="M4 20L21 3"/>
        <polyline points="21,16 21,21 16,21"/>
        <path d="M15 15L21 21"/>
        <path d="M4 4L9 9"/>
    </svg>`,
    
    repeat: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="17,1 21,5 17,9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7,23 3,19 7,15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>`,
    
    repeatOne: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="17,1 21,5 17,9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7,23 3,19 7,15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        <text x="12" y="16" text-anchor="middle" font-size="10" fill="currentColor">1</text>
    </svg>`,
    
    // 音量图标
    volume: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 5L6 9H2v6h4l5 4V5z"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>`,
    
    volumeMute: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 5L6 9H2v6h4l5 4V5z"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>
    </svg>`,
    
    // 导航图标
    playlist: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="3" rx="1"/>
        <rect x="3" y="10" width="18" height="3" rx="1"/>
        <rect x="3" y="16" width="10" height="3" rx="1"/>
        <circle cx="18" cy="17.5" r="2.5" fill="currentColor"/>
        <path d="M16 15v5" stroke-width="1.5"/>
    </svg>`,
    
    clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12,6 12,12 16,14"/>
    </svg>`,
    
    folder: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`,
    
    // 功能图标
    download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7,10 12,15 17,10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`,
    
    search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
    </svg>`,
    
    monitor: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>`,
    
    microphone: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`,
    
    // 操作图标
    plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,
    
    close: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    
    minimize: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,
    
    maximize: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>`,
    
    // 窗口控制图标
    windowClose: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    
    windowMinimize: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,
    
    windowMaximize: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>`,
    
    // 播放模式图标
    sequence: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="5,12 19,12"/>
        <polyline points="15,8 19,12 15,16"/>
    </svg>`,
    
    reverse: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="19,12 5,12"/>
        <polyline points="9,16 5,12 9,8"/>
    </svg>`
};

// 创建SVG图标的辅助函数
function createIcon(name, className = '', size = 20) {
    const iconSvg = icons[name];
    if (!iconSvg) {
        console.warn(`图标 "${name}" 不存在`);
        return icons.music; // 默认图标
    }
    
    // 替换SVG中的尺寸
    const svg = iconSvg.replace(/width="[^"]*"/, `width="${size}"`).replace(/height="[^"]*"/, `height="${size}"`);
    
    return `<span class="icon ${className}">${svg}</span>`;
}

// 导出到全局
window.icons = icons;
window.createIcon = createIcon; 