// 隐私模式（老板键）：一键暂停播放 + 全屏不透明遮罩
// 设计原则：遮罩主体不显示任何文字（不做"此地无银三百两"），
// 仅在底部低调提示退出方法：进入时显示数秒后淡出，鼠标移动时重新出现
const PrivacyMode = {
    active: false,
    player: null,
    accelerator: null,      // 当前老板键键位（用于提示文字）
    _hintTimer: null,       // 淡出定时器
    _mouseListener: null,   // 鼠标移动重现提示

    init(player) {
        this.player = player;

        // 主进程推送的隐私状态变化（老板键在任何应用中触发都会走到这里）
        if (window.electronAPI && electronAPI.privacy && electronAPI.privacy.onStateChanged) {
            electronAPI.privacy.onStateChanged((data) => {
                if (data && typeof data.accelerator !== 'undefined') {
                    this.accelerator = data.accelerator || null;
                }
                this.setState(!!(data && data.active));
            });

            // 快捷键注册失败提示
            if (electronAPI.privacy.onShortcutError) {
                electronAPI.privacy.onShortcutError((data) => {
                    if (data && data.message && window.player && window.player.showMessage) {
                        window.player.showMessage(data.message, 'warning');
                    }
                });
            }
        }
    },

    // 应用内触发（按钮/快捷键）：走主进程统一入口
    toggle() {
        if (window.electronAPI && electronAPI.privacy) {
            electronAPI.privacy.toggle();
        } else {
            this.setState(!this.active);
        }
    },

    setState(active) {
        if (active === this.active) return;
        this.active = active;

        if (active) {
            this.enter();
        } else {
            this.exit();
        }
    },

    enter() {
        // 立即暂停播放（保持播放位置，恢复后手动续播）
        if (this.player && this.player.audio) {
            try { this.player.audio.pause(); } catch (e) { /* 忽略 */ }
        }

        // 全屏不透明遮罩盖住整个窗口（含标题栏）
        document.documentElement.classList.add('privacy-on');

        // 清掉可能残留的消息提示（避免泄露上一条操作内容）
        const container = document.getElementById('message-container');
        if (container) container.innerHTML = '';

        this.showExitHint();

        // 鼠标移动时重新显示退出提示（节流：每次移动重置淡出计时）
        this._mouseListener = () => this.showExitHint();
        document.addEventListener('mousemove', this._mouseListener);
    },

    exit() {
        // 移除遮罩，保持暂停（不自动续播，由用户手动继续）
        document.documentElement.classList.remove('privacy-on');

        if (this._mouseListener) {
            document.removeEventListener('mousemove', this._mouseListener);
            this._mouseListener = null;
        }
        this._clearHintTimer();
    },

    // 底部低调提示退出方法：显示约 4 秒后淡出，鼠标移动时重新出现
    showExitHint() {
        const hint = document.getElementById('privacy-exit-hint');
        if (!hint) return;

        const parts = [];
        if (this.accelerator) parts.push(this.accelerator);
        parts.push('Ctrl+Shift+H');
        hint.textContent = `按 ${parts.join(' 或 ')} 恢复界面`;

        hint.classList.add('visible');
        this._clearHintTimer();
        this._hintTimer = setTimeout(() => {
            hint.classList.remove('visible');
        }, 4000);
    },

    _clearHintTimer() {
        if (this._hintTimer) {
            clearTimeout(this._hintTimer);
            this._hintTimer = null;
        }
    }
};

window.PrivacyMode = PrivacyMode;
