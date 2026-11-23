# 블로그 글 도우미 실행 (start-blog-tool.bat 또는 바탕화면 아이콘이 이 파일을 실행합니다)
# 1) 이미 켜져 있으면 브라우저만 엽니다.
# 2) Node.js가 없거나 버전이 낮으면 안내 후 설치 페이지를 엽니다.
# 3) 처음 실행이면 필요한 부품을 설치합니다(npm install).
# 4) 프로그램을 최소화된 창으로 켜고, 준비되면 브라우저를 엽니다.

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $AppDir
Add-Type -AssemblyName PresentationFramework

function Show-Msg([string]$Text, [string]$Icon = 'Information') {
  [System.Windows.MessageBox]::Show($Text, '블로그 글 도우미', 'OK', $Icon) | Out-Null
}

# 포트: .env의 PORT, 없으면 3000
$Port = 3000
$EnvFile = Join-Path $AppDir '.env'
if (Test-Path -LiteralPath $EnvFile) {
  foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)') { $Port = [int]$Matches[1] }
  }
}
$Url = "http://localhost:$Port"

function Test-Running {
  try {
    $r = Invoke-WebRequest -Uri "$Url/api/status" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# 1) 이미 실행 중
if (Test-Running) { Start-Process $Url; exit 0 }

# 2) Node.js 확인
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  Show-Msg "Node.js가 설치되어 있지 않습니다.`n`n확인을 누르면 설치 페이지가 열립니다. LTS 버전(22 이상)을 설치한 뒤 아이콘을 다시 눌러 주세요." 'Warning'
  Start-Process 'https://nodejs.org'
  exit 1
}
$Ver = ((& $Node.Source -v) -replace '^v', '').Trim()
$Major = [int]($Ver.Split('.')[0])
if ($Major -lt 22) {
  Show-Msg "Node.js 버전이 낮습니다(현재 v$Ver).`n22 이상이 필요합니다. 확인을 누르면 설치 페이지가 열립니다." 'Warning'
  Start-Process 'https://nodejs.org'
  exit 1
}

# 3) 처음 실행: 부품 설치
if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'node_modules\@anthropic-ai\sdk'))) {
  Write-Host ''
  Write-Host '  처음 실행 준비 중입니다. 필요한 부품을 설치합니다(1~2분)...'
  Write-Host ''
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Show-Msg "필요한 부품 설치에 실패했습니다.`n인터넷 연결을 확인한 뒤 아이콘을 다시 눌러 주세요." 'Error'
    exit 1
  }
}

# 4) 프로그램 켜기 (최소화된 창 — 이 창을 닫으면 프로그램이 꺼집니다)
$NodeArgs = @('--env-file-if-exists=.env', 'server.js')
Start-Process -FilePath $Node.Source -ArgumentList $NodeArgs -WorkingDirectory $AppDir -WindowStyle Minimized

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Running) { Start-Process $Url; exit 0 }
}
Show-Msg "프로그램을 시작하지 못했습니다.`n작업 표시줄의 '블로그 글 도우미' 창을 열어 메시지를 확인해 주세요." 'Error'
exit 1
