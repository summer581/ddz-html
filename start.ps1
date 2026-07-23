param(
  [int]$Port = 3000,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

# 控制台使用 UTF-8，避免中文乱码
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch {}

function Stop-WithMessage {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Red
  exit 1
}

# 1. 找到 node：先查 PATH，再查默认安装目录
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $defaultNode = "C:\Program Files\nodejs\node.exe"
  if (Test-Path $defaultNode) {
    $env:PATH = "C:\Program Files\nodejs;$env:PATH"
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (-not $node) {
  Stop-WithMessage "未找到 Node.js。请先安装 Node.js LTS: https://nodejs.org/"
}

$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) {
  Stop-WithMessage "当前 Node.js 版本过低：$(& node -v)。请安装 Node.js 18 或更新版本。"
}

Set-Location -LiteralPath $PSScriptRoot

# 2. 检查端口占用
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($existing) {
  $proc = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
  if ($Restart -and $proc -and $proc.ProcessName -eq 'node') {
    Write-Host "端口 $Port 已被 node 进程 (PID $($proc.Id)) 占用，正在停止..." -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Milliseconds 500
  } else {
    Write-Host "服务已在运行：http://localhost:$Port/ (PID $($existing.OwningProcess))" -ForegroundColor Green
    Write-Host "如需重启，请运行： .\start.ps1 -Restart" -ForegroundColor Yellow
    exit 0
  }
}

# 3. 打印局域网地址
$env:PORT = "$Port"
Write-Host "本机地址： http://localhost:$Port/" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  ForEach-Object { Write-Host "局域网地址： http://$($_.IPAddress):$Port/" -ForegroundColor Green }

Write-Host "正在启动斗地主局域网服务，按 Ctrl+C 停止。" -ForegroundColor Green
& node server.js
