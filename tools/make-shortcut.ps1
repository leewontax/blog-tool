# 바탕화면에 '블로그 글 도우미' 아이콘 만들기 (make-desktop-icon.bat이 실행합니다)
$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName PresentationFramework

try {
  $Desktop = [Environment]::GetFolderPath('Desktop')   # OneDrive 바탕화면도 자동으로 찾음
  $Lnk = Join-Path $Desktop '블로그 글 도우미.lnk'
  $Shell = New-Object -ComObject WScript.Shell
  $Sc = $Shell.CreateShortcut($Lnk)
  $Sc.TargetPath = Join-Path $AppDir 'start-blog-tool.bat'
  $Sc.WorkingDirectory = $AppDir
  $Sc.IconLocation = (Join-Path $AppDir 'tools\app.ico') + ',0'
  $Sc.WindowStyle = 7   # 실행 창 최소화
  $Sc.Description = '블로그 글 도우미 실행'
  $Sc.Save()
  [System.Windows.MessageBox]::Show("바탕화면에 '블로그 글 도우미' 아이콘을 만들었습니다.`n`n이제 아이콘을 더블클릭하면 프로그램이 켜지고 브라우저가 열립니다.`n`n※ 프로그램 폴더를 다른 곳으로 옮기면 이 파일을 다시 실행해 주세요.", '블로그 글 도우미', 'OK', 'Information') | Out-Null
} catch {
  [System.Windows.MessageBox]::Show("아이콘을 만들지 못했습니다.`n$($_.Exception.Message)", '블로그 글 도우미', 'OK', 'Error') | Out-Null
  exit 1
}
