// OCR 模块：调用 Windows 内置 OCR（WinRT OcrEngine，中文简体 + 用户语言回退）
// 零外部依赖、零体积；需要系统安装对应语言包（中文版 Windows 自带）
// 实现说明：经实测，PowerShell 对 WinRT BitmapDecoder.StorageFile 重载解析有坑，
// 这里采用 System.Drawing 解码像素 + SoftwareBitmap.CreateCopyFromBuffer 的路线（已验证可行）
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const OCR_PS1 = `
param([string]$ImagePath)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]

# WinRT IAsyncOperation -> Task 适配
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

try {
    if (-not (Test-Path -LiteralPath $ImagePath)) { throw 'FILE_NOT_FOUND' }

    # 1. System.Drawing 解码图片（超大图自动缩放，OCR 引擎有尺寸上限）
    $src = [System.Drawing.Image]::FromFile($ImagePath)
    $maxDim = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    $width = $src.Width
    $height = $src.Height
    if (($width -gt $maxDim) -or ($height -gt $maxDim)) {
        $scale = [Math]::Min($maxDim / $width, $maxDim / $height)
        $width = [int]([Math]::Floor($width * $scale))
        $height = [int]([Math]::Floor($height * $scale))
    }

    $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, $width, $height)
    $g.Dispose()
    $src.Dispose()

    # 2. 提取 BGRA 像素
    $rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
    $bmpData = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $byteCount = [Math]::Abs($bmpData.Stride) * $height
    $pixels = New-Object byte[] $byteCount
    [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $pixels, 0, $byteCount)
    $bmp.UnlockBits($bmpData)
    $bmp.Dispose()

    # 3. 像素 → SoftwareBitmap
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($pixels)
    $softwareBitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $width, $height)
    if (-not $softwareBitmap) { throw 'BITMAP_FAILED' }

    # 4. OCR 引擎：优先简体中文，其次用户语言
    $engine = $null
    $zhLang = New-Object Windows.Globalization.Language('zh-Hans')
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($zhLang)) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($zhLang)
    }
    if (-not $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if (-not $engine) {
        Write-Output '__NO_OCR_LANGUAGE__'
        exit 2
    }

    # 5. 识别并按行输出
    $result = Await ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
    foreach ($line in $result.Lines) {
        Write-Output $line.Text
    }
    exit 0
} catch {
    Write-Output ('__OCR_ERROR__: ' + $_.Exception.Message)
    exit 1
}
`;

class OcrManager {
    constructor(userDataPath) {
        this.scriptDir = path.join(userDataPath, 'scripts');
        this.scriptPath = path.join(this.scriptDir, 'ocr.ps1');
    }

    // 确保 PowerShell 脚本存在（首次调用时写入）
    // 注意：必须带 UTF-8 BOM，否则 PowerShell 5.1 会按 ANSI/GBK 解析，
    // 中文注释的字节会被误读并破坏变量名/语法
    async ensureScript() {
        await fs.mkdir(this.scriptDir, { recursive: true });
        await fs.writeFile(this.scriptPath, '\ufeff' + OCR_PS1, 'utf8');
    }

    // 识别图片中的文字，返回按行拼接的文本
    async recognizeImage(imagePath) {
        await this.ensureScript();

        const powershellExe = path.join(
            process.env.windir || 'C:\\Windows',
            'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
        );

        return new Promise((resolve) => {
            const child = spawn(powershellExe, [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.scriptPath,
                '-ImagePath', imagePath
            ], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            const timer = setTimeout(() => {
                try { child.kill(); } catch (e) { /* 忽略 */ }
            }, 60000); // 60 秒超时

            child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
            child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });

            child.on('close', (code) => {
                clearTimeout(timer);

                if (stdout.includes('__NO_OCR_LANGUAGE__')) {
                    resolve({
                        success: false,
                        error: '系统未安装 OCR 语言包。请到 Windows 设置 → 时间和语言 → 语言和区域，添加"中文(简体)"或"英语"语言并确保其光学字符识别组件已安装，然后重试。'
                    });
                    return;
                }

                const errMatch = stdout.match(/__OCR_ERROR__: (.*)/);
                if (errMatch) {
                    let msg = errMatch[1].trim();
                    if (msg === 'FILE_NOT_FOUND') msg = '图片文件不存在';
                    resolve({ success: false, error: '识别失败：' + msg });
                    return;
                }

                if (code !== 0 && !stdout.trim()) {
                    resolve({
                        success: false,
                        error: 'OCR 执行失败' + (stderr ? '：' + stderr.trim().split('\n')[0] : '')
                    });
                    return;
                }

                // 按行整理：去空行
                const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length === 0) {
                    resolve({ success: false, error: '未识别到任何文字' });
                    return;
                }

                resolve({ success: true, text: lines.join('\n') });
            });

            child.on('error', (error) => {
                clearTimeout(timer);
                resolve({ success: false, error: '无法启动 PowerShell：' + error.message });
            });
        });
    }
}

module.exports = OcrManager;
