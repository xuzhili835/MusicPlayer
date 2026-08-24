const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

class LyricsManager {
    constructor(lyricsDir = null, tempDir = null, toolsManager = null) {
        // 如果传入了路径参数则使用，否则使用默认路径（向后兼容）
        this.lyricsDir = lyricsDir || path.join(__dirname, 'lyrics');
        this.tempDir = tempDir || path.join(__dirname, 'temp_downloads');
        this.toolsManager = toolsManager; // 用于解析 yt-dlp 的真实可执行路径
        this.proxy = ''; // 可选代理（YouTube 等场景由主进程注入）
        this.subLanguages = ['zh-Hans', 'zh', 'en']; // 按优先级尝试的字幕语言
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

    // ==================== 在线歌词匹配（LRCLIB，免费开源歌词库） ====================

    // GET 一个 JSON 接口（带超时；跟随一次重定向）
    httpGetJson(url, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https://') ? https : http;
            const req = client.get(url, {
                headers: { 'User-Agent': 'SakuraEcho/1.2 (lyrics matching)', 'Accept': 'application/json' },
                timeout: timeoutMs
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.httpGetJson(res.headers.location, timeoutMs).then(resolve, reject);
                    res.resume();
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { reject(new Error('响应不是有效 JSON')); }
                });
            });
            req.on('timeout', () => { req.destroy(new Error('请求超时')); });
            req.on('error', reject);
        });
    }

    // B站搬运标题 → 干净的 (歌名, 艺术家)。
    // 实例：
    //   "_听完这首今晚一定会做甜甜的梦哦！__《おやすみパラレル》_-_花守ゆみり_日推歌单"
    //     → { title: 'おやすみパラレル', artist: '花守ゆみり' }
    //   "Rokudenashi_-_寂寞星空夜【Official_Music_Video】" → { title: '寂寞星空夜', artist: 'Rokudenashi' }
    cleanTitleForLyrics(rawTitle, rawArtist = '') {
        let title = String(rawTitle || '').trim();
        let artist = String(rawArtist || '').trim();
        if (!title) return { title: '', artist };

        // 装饰性标注词：出现在艺术家候选里时视为搬运标注而非人名
        const isNoise = (s) => /^(?:日推歌单|歌单|官方.*|.*字幕|.*完整版|.*版|MV|PV|MAD|AMV|DL.*|.*Radio|.*Cover|翻自.*)$/i.test(s)
            || /官方|字幕|歌单|完整|高清|MV|PV/i.test(s);

        // 1. 书名号《》「」『』内优先作为歌名（B站搬运惯例）；
        //    英文引号段只是后备（常是"中文翻译"前缀，如 "所以我放弃了音乐"_《原曲名》）
        let m = title.match(/[《「『]([^》」』]{2,60})[》」』]/);
        if (m) {
            m = [m[0], m[1], m.index];
        } else {
            const q = title.match(/"([^"]{2,60})"|“([^”]{2,60})”/);
            if (q) m = [q[0], q[1] || q[2], q.index];
        }
        if (m) {
            title = m[1].replace(/_/g, ' ').trim();
            // 歌名右侧的 "_-_艺术家_" 段作为艺术家候选
            const after = rawTitle.slice(rawTitle.indexOf(m[0]) + m[0].length);
            const am = after.match(/[-_]{1,3}\s*([^-_【】\[\]()（）]{2,30}?)[-_]/);
            const cand = am ? am[1].replace(/_/g, ' ').trim() : '';
            if (cand && !isNoise(cand) && !artist) artist = cand;
        } else {
            // 2. 无书名号：剥 【】(..) 装饰段，再按 "A_-_B" / "A - B" 拆艺术家
            let stem = title;
            stem = stem.replace(/[【\[][^】\]]*[】\]]/g, ' ').trim();
            const parts = stem.split(/\s*_+[-–—]_+\s*|\s+[-–—]\s+/);
            if (parts.length >= 2) {
                const a = parts[0].replace(/_/g, ' ').trim();
                const b = parts.slice(1).join(' - ').replace(/_/g, ' ').trim();
                if (a && b && !isNoise(a)) { if (!artist) artist = a; title = b; }
                else if (b) title = b;
            }
        }

        // 3. 剥常见搬运后缀与首尾杂音
        title = title.replace(/(日推歌单|歌单)$/i, '')
            .replace(/[_.\s\-–—]+$/g, '')
            .replace(/^[_.\s\-–—]+/g, '')
            .replace(/_/g, ' ')
            .trim();
        return { title, artist };
    }

    // LRCLIB 匹配：精确 get → 模糊 search（只用歌名，B站的 artist 多为 UP 主名会污染搜索）。
    // 返回 null 表示无命中。时长门禁 ±8s 只作用于"带时间轴"的候选（版本不同时间轴必然
    // 错位）；纯文本歌词无对齐问题，作为兜底（noTimeline: true）。
    async matchOnlineLyrics(rawTitle, rawArtist, durationSec) {
        const { title, artist } = this.cleanTitleForLyrics(rawTitle, rawArtist);
        if (!title) return null;
        const duration = Math.round(Number(durationSec) || 0);

        // 1) 精确匹配（title + artist + duration 全对上）
        if (duration > 0) {
            try {
                const q = new URLSearchParams({ track_name: title, artist_name: artist || '', duration: String(duration) });
                const r = await this.httpGetJson(`https://lrclib.net/api/get?${q}`);
                if (r && r.syncedLyrics && r.syncedLyrics.trim()) {
                    return { syncedLyrics: r.syncedLyrics, matchedTrack: r.trackName, matchedArtist: r.artistName, exact: true };
                }
            } catch (e) { /* 精确没中，继续模糊 */ }
        }

        // 2) 模糊搜索：query 只带歌名；artist 用于候选排序加分
        try {
            const q = new URLSearchParams({ q: title });
            const list = await this.httpGetJson(`https://lrclib.net/api/search?${q}`);
            if (!Array.isArray(list) || !list.length) return null;

            const artistHit = (r) => artist && String(r.artistName || '').includes(artist);
            // 时长差小者优先，其次 artist 命中（排除 DJ/live 等变体版本名的干扰）
            const isVariant = (name) => /DJ|live|remix|伴奏|inst/i.test(String(name || ''));
            const score = (r) => (duration ? Math.abs(r.duration - duration) : 0) + (artistHit(r) ? -20 : 0) + (isVariant(r.trackName) ? 500 : 0);

            // 2a) 带时间轴候选：仅限时长门禁内（版本一致时间轴才有意义）
            const synced = list.filter(r => r.syncedLyrics && r.syncedLyrics.trim() && typeof r.duration === 'number');
            if (duration > 0) {
                const inGate = synced.filter(r => Math.abs(r.duration - duration) <= 8);
                if (inGate.length) {
                    inGate.sort((a, b) => score(a) - score(b));
                    const r = inGate[0];
                    return { syncedLyrics: r.syncedLyrics, matchedTrack: r.trackName, matchedArtist: r.artistName, exact: false, durationDelta: Math.round(r.duration - duration) };
                }
            } else if (synced.length) {
                const r = [...synced].sort((a, b) => score(a) - score(b))[0];
                return { syncedLyrics: r.syncedLyrics, matchedTrack: r.trackName, matchedArtist: r.artistName, exact: false };
            }

            // 2b) 纯文本兜底：无时间轴就没有错位问题（本地是 DJ 版/视频版时常见——
            // 库里只有原版的同步歌词或变体版的纯文本），任何时长差都能用
            const plains = list.filter(r => !r.syncedLyrics && r.plainLyrics && r.plainLyrics.trim());
            if (plains.length) {
                const r = [...plains].sort((a, b) => score(a) - score(b))[0];
                return { plainLyrics: r.plainLyrics, matchedTrack: r.trackName, matchedArtist: r.artistName, noTimeline: true };
            }
        } catch (e) { /* 搜索失败 */ }

        return null;
    }

    // 文本相似度（字符 bigram 的 Dice 系数，0~1）：
    // 用于智能对齐时把在线歌词句与本地转写句配对（两边措辞常有出入，
    // 精确匹配不可行；剥标点与音符后按二元组重合度衡量）
    textSimilarity(a, b) {
        const norm = (s) => String(s || '').replace(/[\s♪♫♩♬~～ー\-—。，、.,！？!?:；;「」『』""''()（）\[\]]/gu, '');
        const A = norm(a), B = norm(b);
        if (A.length < 2 || B.length < 2) return 0;
        const grams = (s) => {
            const g = new Map();
            for (let i = 0; i < s.length - 1; i++) {
                const p = s.slice(i, i + 2);
                g.set(p, (g.get(p) || 0) + 1);
            }
            return g;
        };
        const ga = grams(A), gb = grams(B);
        let inter = 0, total = 0;
        for (const [k, v] of ga) { total += v; inter += Math.min(v, gb.get(k) || 0); }
        for (const v of gb.values()) total += v;
        return total ? (2 * inter) / total : 0;
    }

    // 逐句单调配对（对齐核心）：歌词句与转写句都按时间升序，依序配对且
    // 转写游标只前进（类似 DTW 的单调对齐）。每句在"游标之后 ±windowSec
    // 时间窗"内找最相似句。单调约束防止副歌相似句错配到更晚的段落——
    // 曾因此把某句校准到比下一句还晚 26s 的时刻，播放中长期挂着上一句，
    // 表现为"歌词卡住"。返回 { pairs: [{lrcIdx, wavTime}], deltas: [全局偏移样本] }
    pairMonotonic(lrcLines, wavLines, windowSec = 10, minSim = 0.35) {
        const pairs = [];
        const deltas = [];
        let cursor = 0;
        for (let li = 0; li < lrcLines.length; li++) {
            const l = lrcLines[li];
            if (l.time === null) continue;
            let bestTime = null, bestWi = -1, bestSim = 0;
            for (let wi = cursor; wi < wavLines.length; wi++) {
                const w = wavLines[wi];
                if (w.time - l.time > windowSec) break;    // 转写句已超出右窗，后面更晚
                if (l.time - w.time > windowSec) continue; // 早于左窗，跳过
                const sim = this.textSimilarity(l.text, w.text);
                if (sim > bestSim) { bestSim = sim; bestTime = w.time; bestWi = wi; }
            }
            if (bestTime !== null && bestSim >= minSim) {
                pairs.push({ lrcIdx: li, wavTime: bestTime });
                deltas.push(l.time - bestTime);
                cursor = bestWi + 1;
            }
        }
        return { pairs, deltas };
    }

    // 纯文本歌词与本地转写的合成（在线歌词无时间轴时的加时间戳核心）：
    // "文本要在线的（准确），时间与拆分要本地的（跟演唱走）"。
    // 1:N 区间 DP——一个在线行可吸收多个连续转写行（在线一行常是两三
    // 个演唱短句），配上的在线行按各转写行的字数比例拆开，分别挂转写行
    // 的时刻；未配上的在线行保留整行、时间由前后锚点插值。输出最终
    // [{time, text}] 行集，时间单调不减。返回 { lines, matched, total }
    mergePlainWithWav(plainLines, wavLines, minSim = 0.4) {
        const N = plainLines.length, M = wavLines.length;
        if (!N || !M) return { lines: plainLines.map(l => ({ time: 0, text: l.text })), matched: 0, total: N };

        const MAXSPAN = 6;   // 一个在线行最多吸收的转写行数（行粒度差不会更大）
        const GAP_PLAIN = 0.15, GAP_WAV = 0.02;
        // sim[i][j][len-1]：在线行 i 与转写行区间 j-len+1..j 的相似度
        const sim = Array.from({ length: N }, () => Array.from({ length: M }, () => new Array(MAXSPAN).fill(0)));
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < M; j++) {
                for (let len = 1; len <= MAXSPAN; len++) {
                    const a = j - len + 1;
                    if (a < 0) break;
                    const joined = wavLines.slice(a, j + 1).map(w => w.text).join('');
                    sim[i][j][len - 1] = this.textSimilarity(plainLines[i].text, joined);
                }
            }
        }
        // dp[i][j]：前 i 个在线行覆盖前 j 个转写行的最优总分
        const NEG = -Infinity;
        const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(NEG));
        // back[i][j]：{ k } = 在线行 i-1 吸收转写区间 (k, j]；'plainGap'；'wavGap'
        const back = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(null));
        // dp[0][j] = -j*GAP_WAV：允许开头就跳过多余转写行（前奏哼唱/幻觉），
        // 否则第一行被迫吸收开头所有句，哼唱会被算进拆分比例
        for (let j = 0; j <= M; j++) dp[0][j] = -j * GAP_WAV;
        for (let i = 1; i <= N; i++) {
            for (let j = 0; j <= M; j++) {
                let best = NEG;
                // 在线行 i-1 吸收转写区间 (k, j]
                for (let len = 1; len <= Math.min(MAXSPAN, j); len++) {
                    const k = j - len;
                    if (dp[i - 1][k] === NEG) continue;
                    const s = sim[i - 1][j - 1][len - 1];
                    const v = dp[i - 1][k] + (s >= minSim ? s - minSim : -0.5);
                    if (v > best) { best = v; back[i][j] = { k }; }
                }
                // 在线行无匹配（本地整段漏识别）
                if (j <= M && dp[i - 1][j] !== NEG && dp[i - 1][j] - GAP_PLAIN > best) {
                    best = dp[i - 1][j] - GAP_PLAIN; back[i][j] = 'plainGap';
                }
                // 转写行多余（哼唱/幻觉），跳过
                if (j > 0 && dp[i][j - 1] !== NEG && dp[i][j - 1] - GAP_WAV > best) {
                    best = dp[i][j - 1] - GAP_WAV; back[i][j] = 'wavGap';
                }
                dp[i][j] = best;
            }
        }
        // 终态允许剩尾部多余转写行（尾奏哼唱）不吸收
        let endJ = M;
        for (let j = 0; j <= M; j++) {
            if (dp[N][j] === NEG) continue;
            const v = dp[N][j] - (M - j) * GAP_WAV;
            if (v > dp[N][endJ] - (M - endJ) * GAP_WAV || dp[N][endJ] === NEG) endJ = j;
        }
        // 回溯：plain 行 → 转写区间（或 null）。
        // DP 域的 (k, j] 覆盖 wav 索引 k..j-1，这里换算成 0-based 闭区间
        const spanOf = new Array(N).fill(null);
        let i = N, j = endJ;
        while (i > 0) {
            const b = back[i][j];
            if (b === 'plainGap') { i--; continue; }
            if (b === 'wavGap') { j--; continue; }
            if (b && typeof b.k === 'number') { spanOf[i - 1] = [b.k, j - 1]; i--; j = b.k; continue; }
            break; // dp[0][*] 到达起点（剩余 j 个 wavGap 已在终态结算）
        }
        // 生成合成行
        const out = [];
        let matched = 0;
        for (let pi = 0; pi < N; pi++) {
            const span = spanOf[pi];
            const text = plainLines[pi].text;
            if (!span) {
                out.push({ time: null, text });   // 时间稍后插值
                continue;
            }
            matched++;
            const [a, b] = span;
            const seg = wavLines.slice(a, b + 1);
            if (seg.length === 1) {
                out.push({ time: seg[0].time, text });
            } else {
                // 按各转写行字数比例把在线文本拆开，分别挂转写时刻
                const totalChars = seg.reduce((s, w) => s + w.text.replace(/\s/g, '').length, 0) || 1;
                const plainChars = text.replace(/\s/g, '');
                let pos = 0;
                for (let si = 0; si < seg.length; si++) {
                    const isLast = si === seg.length - 1;
                    const take = isLast ? Infinity : Math.max(1, Math.round(plainChars.length * seg[si].text.replace(/\s/g, '').length / totalChars));
                    const chunk = isLast ? plainChars.slice(pos) : plainChars.slice(pos, pos + take);
                    pos += take;
                    if (chunk.trim()) out.push({ time: seg[si].time, text: chunk.trim() });
                }
            }
        }
        // 未配对行插值（前后锚点线性；首部倒推/尾部顺延）。
        // 注意用数组下标找锚点——out 元素本身没有 idx 属性
        const withTime = out.map((o, idx) => ({ ...o, idx })).filter(o => o.time !== null);
        if (withTime.length) {
            const first = withTime[0], last = withTime[withTime.length - 1];
            const rows = last.idx - first.idx || 1;
            const avgGap = (last.time - first.time) / rows;
            out.forEach((o, oi) => {
                if (o.time !== null) return;
                let prev = null, next = null;
                for (const w of withTime) { if (w.idx < oi) prev = w; else if (w.idx > oi) { next = w; break; } }
                if (prev && next) o.time = prev.time + (next.time - prev.time) * (oi - prev.idx) / (next.idx - prev.idx);
                else if (prev) o.time = prev.time + avgGap;
                else if (next) o.time = Math.max(0, next.time - avgGap * (next.idx - oi));
            });
        } else {
            out.forEach(o => { o.time = 0; });
        }
        for (let k = 1; k < out.length; k++) out[k].time = Math.max(out[k].time, out[k - 1].time);
        return { lines: out, matched, total: N };
    }

    // 把合成行写盘为带时间轴的 LRC（保留 [source:] 等头部标签）
    async writeMergedLyrics(songTitle, sourceContent, lines) {
        const out = [];
        for (const raw of String(sourceContent || '').split('\n')) {
            const text = raw.trim();
            if (!text) continue;
            // 头部标签（[source:] 等，非时间标签）保留在最前
            if (/^\[.*\]\s*$/.test(text) && !/^\[(\d{1,3}):/.test(text)) out.push(text);
        }
        for (const l of lines) out.push(this.formatLrcTime(Math.max(0, l.time || 0)) + ' ' + l.text);
        const lrcPath = this.getLrcPath(songTitle);
        await fs.writeFile(lrcPath, out.join('\n'), 'utf8');
        return lrcPath;
    }

    // 对齐计算（alignLyrics 的纯逻辑核心）。audioDuration = 本地音源时长：
    //  - 与在线轴最后一句相差 <= 2s 判定"同版本"：在线时间轴的相对节奏
    //    本来就是准的，只做全局微移（±2.5s 封顶），不逐句改写。曾因某段
    //    whisper 锚点时间抖动几秒，32~47s 段整段跟着错位（花人局：本地
    //    5:33 vs 在线 5:32，总时长差 <1s 却被分段推移了好几秒）
    //  - 时长差大（剪辑/搬运版）：配对（低配对率时放宽一档窗口）+ 分段
    //    偏移，且先剔除"孤峰锚点"——真实剪辑差是阶跃（后续锚点持续同向），
    //    whisper 单句时间抖动是尖峰（前后锚点都不同意它），由此区分
    // 返回 { alignedTimes, median, pairs, total } 或 { error }
    computeAlignedTimes(lrcLines, wavLines, audioDuration = null) {
        let lastLrcTime = null;
        for (let i = lrcLines.length - 1; i >= 0; i--) {
            if (lrcLines[i].time !== null) { lastLrcTime = lrcLines[i].time; break; }
        }
        const durDiff = (audioDuration && lastLrcTime !== null)
            ? Math.abs(audioDuration - lastLrcTime) : null;
        const sameVersion = durDiff !== null && durDiff <= 2;

        let { pairs, deltas } = this.pairMonotonic(lrcLines, wavLines);
        // 放宽窗口仅当疑似结构差异：同版本绝不放宽——20s 窗会把副歌相似句
        // 配到十几秒外，锚点反而更脏
        if (!sameVersion && pairs.length < lrcLines.length * 0.5 && lrcLines.length >= 8) {
            const wider = this.pairMonotonic(lrcLines, wavLines, 20);
            if (wider.pairs.length > pairs.length) {
                pairs = wider.pairs; deltas = wider.deltas;
            }
        }
        if (pairs.length < 2 || pairs.length < lrcLines.length * 0.3) {
            return { error: `只配对上 ${pairs.length}/${lrcLines.length} 句，不足以校准（本地音源与在线歌词版本差异可能过大）` };
        }
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)];
        if (Math.abs(median) > 30) {
            return { error: `校准量过大（${median.toFixed(1)} 秒），可能是不同版本/变速搬运，已放弃` };
        }

        // 同版本：全局微移（在线轴的相对节奏可信，whisper 逐句时刻噪声更大）
        if (sameVersion) {
            const shift = Math.max(-2.5, Math.min(2.5, median));
            const alignedTimes = lrcLines.map(l => Math.max(0, l.time - shift));
            return { alignedTimes, median, pairs: pairs.length, total: lrcLines.length, mode: 'same-version' };
        }

        // 结构差异版：锚点剔野（V 形孤峰 + 无佐证的首尾离群）→ 分段偏移
        const anchors = pairs.map(p => ({
            lrcIdx: p.lrcIdx, wavTime: p.wavTime,
            delta: lrcLines[p.lrcIdx].time - p.wavTime
        }));
        const kept = anchors.filter((a, i) => {
            const prev = i > 0 ? anchors[i - 1].delta : null;
            const next = i < anchors.length - 1 ? anchors[i + 1].delta : null;
            // 内部孤峰：与两侧锚点都差 >3s（不问方向——峰值/谷值都算）。
            // 真实阶跃的边界锚点只会背离一侧（另一侧邻居已在新偏移上）
            if (prev !== null && next !== null
                && Math.abs(a.delta - prev) > 3 && Math.abs(a.delta - next) > 3) return false;
            // 首尾锚点只有一侧邻居：既背离邻居 >5s 又背离全局中位数 >4s 才剔
            if (prev === null && next !== null
                && Math.abs(a.delta - next) > 5 && Math.abs(a.delta - median) > 4) return false;
            if (next === null && prev !== null
                && Math.abs(a.delta - prev) > 5 && Math.abs(a.delta - median) > 4) return false;
            return true;
        });
        // 分段偏移（锚点间线性插值的时间扭曲）：配对句用本地演唱时刻（实测）；
        // 未配对句在前后锚点之间按时间比例插值偏移——剪辑版在间奏处产生
        // 阶跃错位后，间奏内/后第一句（常因窗口够不着而未配对）也能平滑
        // 过渡到新偏移，而不是沿用旧锚点整句错位
        const pairedTime = new Map(kept.map(p => [p.lrcIdx, p.wavTime]));
        const alignedTimes = lrcLines.map((l, i) => {
            if (pairedTime.has(i)) return pairedTime.get(i);
            // 前后最近锚点（剔除后仍存留的）
            let prevA = null, nextA = null;
            for (const a of kept) {
                if (a.lrcIdx < i) prevA = a;
                else if (a.lrcIdx > i) { nextA = a; break; }
            }
            let delta;
            if (prevA && nextA) {
                const span = lrcLines[nextA.lrcIdx].time - lrcLines[prevA.lrcIdx].time;
                const r = span > 0 ? (l.time - lrcLines[prevA.lrcIdx].time) / span : 0;
                delta = prevA.delta + (nextA.delta - prevA.delta) * Math.min(1, Math.max(0, r));
            } else if (nextA) delta = nextA.delta;   // 前奏区未配对句跟随首个锚点
            else if (prevA) delta = prevA.delta;      // 尾奏区沿用最后锚点
            else delta = median;
            return Math.max(0, l.time - delta);
        });
        return { alignedTimes, median, pairs: pairs.length, total: lrcLines.length, mode: 'structural' };
    }

    // 读取 LRC 文件内容里的 [offset:±ms]（无则 0）
    readOffsetMs(lrcContent) {
        const m = String(lrcContent || '').match(/^\[offset:\s*([+-]?\d+)\s*\]/im);
        return m ? (parseInt(m[1], 10) || 0) : 0;
    }

    // 把绝对偏移写进 LRC 文件头（[offset:+500] = 提前 500ms，LRC 标准）。
    // 智能对齐写计算出的绝对值；手动微调传"当前值 + 差量"。
    async writeOffsetMs(songTitle, absoluteMs) {
        const lrcPath = this.getLrcPath(songTitle);
        let content = await fs.readFile(lrcPath, 'utf8');
        // 去掉已有 offset 标签（含其后换行），再在头部插入新标签
        content = content.replace(/^\[offset:[^\]]*\][ \t]*\r?\n?/im, '');
        const tag = `[offset:${absoluteMs >= 0 ? '+' : ''}${Math.round(absoluteMs)}]\n`;
        await fs.writeFile(lrcPath, tag + content, 'utf8');
        return Math.round(absoluteMs);
    }

    // 把逐句校准后的时间轴写回 LRC：仅替换带时间标签行的时间戳，
    // 文本与其他行（[by:] 等）原样保留；旧的 [offset:] 丢弃（时间轴已本地化，
    // 重新校准覆盖此前的手动微调）。
    // 解析单行 LRC：返回 { time, text }，无时间标签返回 null。
    // text 已按展示规则规范化（剥 ♪ 前缀）；空串表示"带时间戳的伴奏/
    // 哼唱标记行"（LRCLIB 的间奏标记，形如 [00:17.71] 空行）。
    // parseLrcContent（读取）与 writeAlignedLyrics（写回）共用此方法，
    // 保证两边对"哪些行算歌词行"的判定严格一致——曾因写回端把伴奏空行
    // 也当作歌词行消耗索引，导致空行之后的每一句都拿到下一句的校准时间
    // （有间奏标记的歌如花人局整轴后移，无标记的歌完全正常）。
    parseLrcLine(line) {
        const trimmedLine = String(line || '').trim();
        if (!trimmedLine) return null;
        const timeMatch = trimmedLine.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)/);
        if (!timeMatch) return null;
        const minutes = parseInt(timeMatch[1], 10);
        const seconds = parseInt(timeMatch[2], 10);
        // 小数部分按位数换算为秒：2位=百分秒(/100)，3位=毫秒(/1000)
        const fracStr = timeMatch[3] || '0';
        const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
        // 剥掉转写常输出的行首音符符号（♪/♫ 等），它不是歌词内容
        let text = timeMatch[4].trim().replace(/^[♪♫♩♬]/gu, '').trim();
        // 间奏哼唱标注（"♪~"）：剥掉音符后只剩波浪线/长音符/连字符，也不是歌词
        if (/^[~～ー\-—\s]*$/.test(text)) text = '';
        return { time: minutes * 60 + seconds + frac, text };
    }

    // 秒数格式化为 LRC 时间标签 [mm:ss.xx]
    formatLrcTime(t) {
        const mm = Math.floor(t / 60);
        const ss = (t % 60).toFixed(2).padStart(5, '0');
        return `[${String(mm).padStart(2, '0')}:${ss}]`;
    }

    // alignedTimes: 与 parseLrcContent 解析出的"歌词行"（有文本且非元数据）
    // 按出现顺序一一对应的新时间（秒）；globalShift: 校准发现的整体偏移
    // （标注时间 - 本地演唱时间），伴奏空行按它平移
    async writeAlignedLyrics(songTitle, originalContent, alignedTimes, globalShift = 0) {
        // 写回前强制单调不减：即使个别句错配，也不允许写出"比下一句还晚"
        // 的乱序时间轴（错句宁可时间保守，乱序会让播放中的切换长期滞留）
        const times = (alignedTimes || []).map(t => Math.max(0, t));
        for (let i = 1; i < times.length; i++) {
            times[i] = Math.max(times[i], times[i - 1]);
        }
        const out = [];
        let i = 0;
        for (const raw of String(originalContent || '').split('\n')) {
            const trimmed = raw.trim();
            if (/^\[offset:/i.test(trimmed)) continue;
            const parsed = this.parseLrcLine(raw);
            if (parsed) {
                // 保留时间标签之后的全部内容（含行内其他标签）
                const tagMatch = trimmed.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/);
                const rest = trimmed.slice(tagMatch.index + tagMatch[0].length);
                if (parsed.text && !this.isLyricMetadata(parsed.text) && !this.isPureTagText(parsed.text)) {
                    // 歌词行：按索引消耗校准时间（与解析端行序严格一致）
                    if (i < times.length) {
                        out.push(this.formatLrcTime(times[i++]) + rest);
                    } else {
                        out.push(raw);
                    }
                } else if (!parsed.text) {
                    // 带时间戳的空行 = 伴奏/间奏标记：按整体偏移平移，保持标记准确
                    out.push(this.formatLrcTime(Math.max(0, parsed.time - globalShift)) + rest);
                } else {
                    // 元数据（作词/作曲等）与 [Muziek] 类标签行：原样保留
                    out.push(raw);
                }
            } else {
                out.push(raw);
            }
        }
        const lrcPath = this.getLrcPath(songTitle);
        await fs.writeFile(lrcPath, out.join('\n'), 'utf8');
        return lrcPath;
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
    async downloadLyrics(videoUrl, songTitle, onProgress = null) {
        try {
            console.log(`开始下载歌词: ${songTitle}`);
            
            // 尝试下载字幕
            onProgress?.({ progress: 0, status: '正在查找字幕...' });
            const subtitlePath = await this.downloadSubtitles(videoUrl, songTitle, onProgress);
            
            if (!subtitlePath) {
                console.log('没有找到可用的字幕');
                return null;
            }

            // 转换为LRC格式
            onProgress?.({ progress: 90, status: '正在转换字幕...' });
            const lrcContent = await this.convertToLrc(subtitlePath);
            
            if (!lrcContent) {
                console.log('字幕转换失败');
                return null;
            }

            // 保存LRC文件（标注来源：平台字幕）
            const lrcPath = this.getLrcPath(songTitle);
            onProgress?.({ progress: 96, status: '正在保存歌词...' });
            await fs.writeFile(lrcPath, `[source:subtitle]\n${lrcContent}`, 'utf8');
            
            // 清理临时文件
            try {
                await fs.unlink(subtitlePath);
            } catch (error) {
                console.log('清理临时文件失败:', error);
            }

            console.log(`歌词下载完成: ${lrcPath}`);
            onProgress?.({ progress: 100, status: '歌词下载完成' });
            return lrcPath;
        } catch (error) {
            console.error('下载歌词失败:', error);
            return null;
        }
    }

    // 下载字幕文件
    async downloadSubtitles(videoUrl, songTitle, onProgress = null) {
        try {
            const cleanTitle = this.cleanFileName(songTitle);
            const outputTemplate = path.join(this.tempDir, `${cleanTitle}.%(ext)s`);

            // 通过工具管理器解析 yt-dlp 真实路径（兼容仅内置 bin 的场景）
            let ytdlpPath = 'yt-dlp';
            if (this.toolsManager) {
                const resolved = await this.toolsManager.getExecutableCommand('yt-dlp');
                if (resolved) ytdlpPath = resolved;
            }

            const args = [
                '--write-subs',
                // 作者字幕优先；没有作者字幕时，再下载平台生成的自动字幕。
                '--write-auto-subs',
                '--skip-download',
                '--sub-lang', this.subLanguages.join(','),
                '--output', outputTemplate,
                // 浏览器 UA（B站风控必需）
                '--user-agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            ];

            // 站点专属 Referer（规避 B站 412 风控）
            if (/bilibili\.com|b23\.tv/i.test(videoUrl)) {
                args.push('--add-headers', 'Referer:https://www.bilibili.com/');
            }

            // 代理（主进程注入，YouTube 场景）
            if (this.proxy) {
                args.push('--proxy', this.proxy);
            }

            args.push(videoUrl);

            console.log('下载字幕:', ytdlpPath, args.join(' '));
            await this.runYtDlp(ytdlpPath, args, onProgress);

            // 按语言优先级查找下载的字幕文件。yt-dlp 可能给自动字幕追加
            // "-orig"、"-auto" 等后缀，因此不能只检查精确文件名。
            const subtitleFormats = ['srt', 'vtt', 'ass'];
            const downloadedFiles = await fs.readdir(this.tempDir);
            for (const lang of this.subLanguages) {
                for (const ext of subtitleFormats) {
                    const prefix = `${cleanTitle}.${lang}`.toLowerCase();
                    const file = downloadedFiles.find(name =>
                        name.toLowerCase().startsWith(prefix) && name.toLowerCase().endsWith(`.${ext}`));
                    if (file) return path.join(this.tempDir, file);
                }
            }

            // 兜底：查找无语言后缀的字幕文件
            for (const ext of subtitleFormats) {
                const file = downloadedFiles.find(name =>
                    name.toLowerCase() === `${cleanTitle}.${ext}`.toLowerCase());
                if (file) return path.join(this.tempDir, file);
            }

            return null;
        } catch (error) {
            console.error('下载字幕失败:', error.message);
            return null;
        }
    }

    // 使用 --newline 将 yt-dlp 的实时输出拆行，供界面显示字幕下载百分比。
    runYtDlp(executable, args, onProgress) {
        return new Promise((resolve, reject) => {
            const child = spawn(executable, [...args, '--newline'], { windowsHide: true });
            let stderr = '';
            let settled = false;
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, 60000);
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (error) reject(error);
                else resolve();
            };
            const report = (chunk) => {
                const text = chunk.toString();
                for (const line of text.split(/\r?\n/)) {
                    const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
                    if (match) onProgress?.({
                        progress: Math.min(89, parseFloat(match[1]) * 0.89),
                        status: '正在下载字幕...'
                    });
                }
            };
            child.stdout.on('data', report);
            child.stderr.on('data', data => {
                stderr += data.toString();
                report(data);
            });
            child.on('error', finish);
            child.on('close', code => {
                if (code === 0) finish();
                else finish(new Error(timedOut ? '下载字幕超时' : (stderr.trim() || `yt-dlp 下载字幕失败（退出码 ${code}）`)));
            });
        });
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
            const parts = timeStr.trim().replace(',', '.').split(':');
            if (parts.length !== 2 && parts.length !== 3) return '00:00.00';
            const hours = parts.length === 3 ? parseInt(parts[0], 10) || 0 : 0;
            const minutePart = parts.length === 3 ? parts[1] : parts[0];
            const secondPart = parts.length === 3 ? parts[2] : parts[1];
            const minutes = (parseInt(minutePart, 10) || 0) + hours * 60;
            const seconds = parseFloat(secondPart) || 0;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
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
            let hasTimestamps = false;
            // [offset:±ms]：正值 = 歌词整体提前显示（LRC 标准）。对齐校准与手动微调都写这个标签，
            // 保留原始时间轴可反复调整。
            let offsetMs = 0;
            for (const line of lines) {
                const om = line.trim().match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
                if (om) offsetMs = parseInt(om[1], 10) || 0;
            }
            const offsetSec = offsetMs / 1000;

            for (const line of lines) {
                const parsed = this.parseLrcLine(line);
                if (!parsed) continue;
                hasTimestamps = true;

                // 部分字幕/转写会把作词、作曲、作者等制作信息做成带时间轴的首行。
                // 这些不是播放时应展示的歌词，避免桌面歌词长期停在元数据上。
                // [Muziek]/[Music] 等纯环境标签行（whisper 对纯音乐的输出）同样跳过。
                if (!parsed.text || this.isLyricMetadata(parsed.text) || this.isPureTagText(parsed.text)) continue;

                const totalSeconds = Math.max(0, parsed.time - offsetSec);

                lyrics.push({
                    time: totalSeconds,
                    text: parsed.text
                });
            }

            // 纯文本歌词（无时间标签）：按行保留，time 为 null。
            // 过滤 [by:xxx]/[ti:xxx] 等纯标签行——whisper 对纯音乐的输出只有
            // "[by:whisper.cpp]" 一行，不能把它当歌词显示在桌面歌词上。
            if (!hasTimestamps) {
                const plainLines = lines
                    .map(l => l.trim())
                    .filter(l => l.length > 0 && !this.isPureTagText(l));
                return plainLines.map(l => ({ time: null, text: l }));
            }

            // 按时间排序
            lyrics.sort((a, b) => a.time - b.time);

            return lyrics;
        } catch (error) {
            console.error('解析LRC内容失败:', error);
            return null;
        }
    }

    isLyricMetadata(text) {
        const normalized = String(text || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (!normalized) return true;
        if (/^(?:作词|作曲|编曲|演唱|歌手|原唱|制作|制作人|词|曲)\s*[:：]/i.test(normalized)) return true;
        return /^(?:作词|作曲|编曲|演唱|歌手|原唱|制作人?|作者|作家)$/i.test(normalized);
    }

    // 是否为纯方括号标签文本（非歌词）：[Muziek]/[Music]/[Applause]/[by:whisper.cpp] 等
    isPureTagText(text) {
        const normalized = String(text || '').trim();
        if (!normalized) return true;
        // 整行由一个或多个 [xxx] 标签组成（允许首尾空白）
        if (/^(\[[^\]]*\]\s*)+$/.test(normalized)) return true;
        // 常见环境音标注（whisper 对无人声音频的幻听输出）
        return /^\s*\[?(?:muziek|music|applause|silence|noise|instrumental)s?\]?\s*$/i.test(normalized);
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

    // 读取歌词来源标签（[source:lrclib|whisper|subtitle|manual]；无标签时回退推断）
    readSource(lrcContent) {
        const content = String(lrcContent || '');
        const m = content.match(/^\[source:\s*([a-z]+)\s*\]/im);
        if (m) return m[1].toLowerCase();
        if (/^\[by:whisper\.cpp\]/im.test(content)) return 'whisper';
        return '';
    }

    // 保存手动编辑的歌词（source: lrclib/whisper/subtitle/manual，写进文件头供面板显示来源）
    async saveLyrics(songTitle, lrcContent, source = null) {
        try {
            const lrcPath = this.getLrcPath(songTitle);
            let content = String(lrcContent || '');
            if (source && !/^\[source:/im.test(content)) {
                content = `[source:${source}]\n` + content.replace(/^\uFEFF/, '');
            }
            await fs.writeFile(lrcPath, content, 'utf8');
            console.log(`歌词已保存: ${lrcPath}`);
            return true;
        } catch (error) {
            console.error('保存歌词失败:', error);
            return false;
        }
    }

    // 列出已有歌词的文件名主干（cleanFileName 后的标题，用于判断哪些歌曲缺歌词）。
    // 只统计"解析后确有歌词行"的文件：纯音乐转写残留（[Muziek]/[by:whisper.cpp]）
    // 不能算已有歌词，否则列表 ♪ 标记误亮、批量识别也会被跳过。
    async listLyricsStems() {
        try {
            const files = await fs.readdir(this.lyricsDir);
            const stems = new Set();
            for (const file of files) {
                if (!file.toLowerCase().endsWith('.lrc')) continue;
                const parsed = await this.parseLrcFile(path.join(this.lyricsDir, file));
                if (parsed && parsed.length > 0) {
                    stems.add(file.replace(/\.lrc$/i, ''));
                }
            }
            return stems;
        } catch (error) {
            return new Set();
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
