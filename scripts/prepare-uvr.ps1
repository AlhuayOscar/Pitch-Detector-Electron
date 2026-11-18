[CmdletBinding()]
param(
    [string] $PythonExe,
    [string] $FFmpegExe
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project '.uvr'
$downloads = Join-Path $runtime 'downloads'
$source = Join-Path $runtime 'ultimatevocalremovergui'
$venv = Join-Path $runtime 'venv'
$python = Join-Path $venv 'Scripts\python.exe'
$readyFile = Join-Path $runtime 'ready.json'
$sourceStamp = Join-Path $runtime 'source-commit.txt'

$commit = 'a897c05a82b1d6bd5979911535cebe248315f5ae'
$sourceSha256 = '9528C999BA1BD6F5C5FB459B4ACE093FFBAEE6F2FF78207FFA9FB6AD30B9B0B8'
$modelName = 'UVR-MDX-NET-Inst_Main.onnx'
$modelSha256 = '8AB401DFE4A548B87DEB64F975294BD56FF946AA32903F53B4B24BB13B2CCE1E'
$modelUrl = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/' + $modelName
$rubberBandSha256 = '3EF6ADC2D7B4658AACE0D8DF3C186A9745CD9D122C45ED08D7F3C9A32A48C05E'
$sourceUrl = "https://codeload.github.com/Anjok07/ultimatevocalremovergui/zip/$commit"
$rubberBandUrl = 'https://breakfastquay.com/files/releases/rubberband-3.1.2-gpl-executable-windows.zip'
$licenseUrl = 'https://raw.githubusercontent.com/Anjok07/ultimatevocalremovergui/ca61edf1c0766267d5498f9a5bc704f19e394478/LICENSE'

function Get-HashMatches($file, $expectedHash) {
    (Test-Path -LiteralPath $file -PathType Leaf) -and
        (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $expectedHash
}

function Get-VerifiedDownload($url, $file, $expectedHash) {
    if (Get-HashMatches $file $expectedHash) { return }
    $partial = "$file.partial"
    & curl.exe --proto '=https' --proto-redir '=https' --fail --location --retry 2 --silent --show-error $url -o $partial
    if ($LASTEXITCODE -ne 0 -or -not (Get-HashMatches $partial $expectedHash)) {
        throw "La descarga no coincide con la suma SHA-256 esperada. $url"
    }
    Move-Item -LiteralPath $partial -Destination $file -Force
}

New-Item -ItemType Directory -Path $downloads -Force | Out-Null
if (Test-Path -LiteralPath $readyFile) {
    Remove-Item -LiteralPath $readyFile -Force
}

$sourceArchive = Join-Path $downloads "uvr-$commit.zip"
Get-VerifiedDownload $sourceUrl $sourceArchive $sourceSha256

if (Test-Path -LiteralPath $source) {
    if (-not (Test-Path -LiteralPath $sourceStamp) -or (Get-Content -LiteralPath $sourceStamp -Raw).Trim() -ne $commit) {
        throw "Ya existe una carpeta UVR sin la versión esperada. Conserva tus modelos y configura otra carpeta de proyecto."
    }
} else {
    Expand-Archive -LiteralPath $sourceArchive -DestinationPath $runtime -Force
    Rename-Item -LiteralPath (Join-Path $runtime "ultimatevocalremovergui-$commit") -NewName 'ultimatevocalremovergui'
    Set-Content -LiteralPath $sourceStamp -Value $commit -Encoding Ascii
}

if (-not (Get-HashMatches (Join-Path $source 'UVR.py') '0EA8EBE7C29A4DF0C45E9B24A5E4714E144EDB9C8529BB8AA4F9AD7767EBAE9E')) {
    throw 'UVR.py no coincide con el código oficial del commit esperado.'
}

$license = Join-Path $source 'LICENSE-UVR.txt'
if (-not (Test-Path -LiteralPath $license)) {
    Invoke-WebRequest -UseBasicParsing -Uri $licenseUrl -OutFile $license
}

if (-not (Test-Path -LiteralPath $python)) {
    $pythonLauncher = if ($PythonExe) { $PythonExe } else { (Get-Command py.exe).Source }
    $pythonArgs = if ($PythonExe) { @() } else { @('-3.10') }
    'import sys, struct, tkinter; assert sys.version_info[:2] == (3, 10) and struct.calcsize("P") == 8' |
        & $pythonLauncher @pythonArgs -
    if ($LASTEXITCODE -ne 0) { throw 'Se requiere Python 3.10 x64 con Tkinter.' }
    & $pythonLauncher @pythonArgs -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno local de Python.' }
}

$dependencies = @(
    'torch==2.9.1+cpu', 'torchvision==0.24.1+cpu', 'numpy==1.26.4', 'scipy==1.11.4',
    'numba==0.59.1', 'librosa==0.9.2', 'onnx==1.17.0', 'onnxruntime==1.23.2',
    'onnx2pytorch==0.5.3', 'pillow==9.5.0', 'opencv-python==4.10.0.84', 'soundfile==0.12.1',
    'natsort==8.4.0', 'pyglet==1.5.31', 'cryptography==50.0.2', 'psutil==7.2.2',
    'pyperclip==1.8.2', 'wget==3.2', 'matchering==2.0.6', 'ml_collections==0.1.1',
    'kthread==0.2.3', 'playsound==1.3.0', 'PyYAML==6.0.2', 'pydub==0.25.1',
    'tqdm==4.70.1', 'omegaconf==2.3.0', 'einops==0.8.2', 'julius==0.2.7',
    'pytorch_lightning==2.5.6', 'samplerate==0.2.3', 'screeninfo==0.8.1',
    'pyrubberband==0.4.0', 'diffq==0.2.3'
)
& $python -m pip install --disable-pip-version-check --no-cache-dir --progress-bar off @dependencies --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las dependencias de UVR.' }

$modelPath = Join-Path $source "models\MDX_Net_Models\$modelName"
if (-not (Get-HashMatches $modelPath $modelSha256)) {
    if (Test-Path -LiteralPath $modelPath) { throw "El modelo existente en $modelPath tiene otra suma SHA-256." }
    $modelDownload = Join-Path $downloads $modelName
    Get-VerifiedDownload $modelUrl $modelDownload $modelSha256
    Copy-Item -LiteralPath $modelDownload -Destination $modelPath
}

$rubberBandArchive = Join-Path $downloads 'rubberband-3.1.2.zip'
Get-VerifiedDownload $rubberBandUrl $rubberBandArchive $rubberBandSha256
if (-not (Test-Path -LiteralPath (Join-Path $source 'rubberband.exe'))) {
    Expand-Archive -LiteralPath $rubberBandArchive -DestinationPath $downloads -Force
    $rubberBandDir = Join-Path $downloads 'rubberband-3.1.2-gpl-executable-windows'
    Copy-Item -LiteralPath (Join-Path $rubberBandDir 'rubberband.exe'), (Join-Path $rubberBandDir 'sndfile.dll') -Destination $source
    Copy-Item -LiteralPath (Join-Path $rubberBandDir 'COPYING.txt') -Destination (Join-Path $source 'LICENSE-Rubber-Band.txt')
}

if ($FFmpegExe) {
    $ffmpegPath = (Resolve-Path -LiteralPath $FFmpegExe).Path
    Copy-Item -LiteralPath $ffmpegPath -Destination (Join-Path $source 'ffmpeg.exe') -Force
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $ffmpegPath) 'ffprobe.exe') -Destination $source -Force
}

Push-Location -LiteralPath $source
try {
    $validation = @"
import sys
import onnxruntime as ort
import UVR

assert UVR.VERSION == "v5.6.0"
model = ort.InferenceSession(sys.argv[1], providers=["CPUExecutionProvider"])
print(UVR.VERSION, model.get_inputs()[0].shape, model.get_providers())
"@
    $validation | & $python - $modelPath
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo cargar UVR y su modelo local de separación.' }
} finally {
    Pop-Location
}

[ordered]@{
    version = '5.6.0'
    commit = $commit
    sourceUrl = $sourceUrl
    modelName = $modelName
    modelSha256 = $modelSha256
    modelUrl = $modelUrl
    backend = 'CPU'
} | ConvertTo-Json | Set-Content -LiteralPath "$readyFile.partial" -Encoding Ascii
Move-Item -LiteralPath "$readyFile.partial" -Destination $readyFile -Force
Write-Host "VocalRemover preparado en $runtime"
