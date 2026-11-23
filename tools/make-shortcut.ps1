# 바탕화면에 '블로그 글 도우미' 아이콘 만들기 (make-desktop-icon.bat이 실행합니다)
$ErrorActionPreference = 'Stop'
try {
  $AppDir = Split-Path -Parent $PSScriptRoot
  $Desktop = [Environment]::GetFolderPath('Desktop')   # OneDrive 바탕화면도 자동으로 찾음
  if (-not $Desktop -or -not (Test-Path -LiteralPath $Desktop)) { throw "바탕화면 폴더를 찾지 못했습니다." }
  $Lnk = Join-Path $Desktop '블로그 글 도우미.lnk'
  Write-Host "  프로그램 폴더: $AppDir"
  Write-Host "  바탕화면 폴더: $Desktop"

  $Shell = New-Object -ComObject WScript.Shell
  $Sc = $Shell.CreateShortcut($Lnk)
  $Sc.TargetPath = Join-Path $AppDir 'start-blog-tool.bat'
  $Sc.WorkingDirectory = $AppDir
  $Sc.IconLocation = (Join-Path $AppDir 'tools\app.ico') + ',0'
  $Sc.WindowStyle = 7   # 실행 창 최소화
  $Sc.Description = '블로그 글 도우미 실행'
  $Sc.Save()

  if (-not (Test-Path -LiteralPath $Lnk)) { throw "아이콘 파일이 만들어지지 않았습니다(보안 프로그램 차단 가능)." }
  Write-Host "  아이콘을 만들었습니다: $Lnk"
  exit 0
} catch {
  Write-Host ""
  Write-Host "  [오류] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
