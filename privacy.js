// 隐私模式（老板键）：一键暂停播放 + 全屏不透明遮罩
// 设计原则：遮罩上不显示任何文字提示（包括"隐私模式已开启"），只保留低对比度 logo
const PrivacyMode = {
    active: false,
    player: null,

    init(player) {
        this.player = player;

        // 主进程推送的隐私状态变化（老板键在任何应用中触发都会走到这里）
        if (window.electronAPI && electronAPI.privacy && electronAPI.privacy.onStateChanged) {
            electronAPI.privacy.onStateChanged((data) => {
                this.setState(!!data.active);
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
            // 兜底：preload 不可用时直接本地切换
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
    },

    exit() {
        // 移除遮罩，保持暂停（不自动续播，由用户手动继续）
        document.documentElement.classList.remove('privacy-on');
    }
};

window.PrivacyMode = PrivacyMode;
