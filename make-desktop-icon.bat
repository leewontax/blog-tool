@echo off
cd /d "%~dp0"
echo.
echo  ==============================================
echo    블로그 글 도우미 - 바탕화면 아이콘 만들기
echo  ==============================================
echo.
if not exist "%~dp0tools\make-shortcut.ps1" goto NOTOOLS
if not exist "%~dp0start-blog-tool.bat" goto NOTOOLS

echo  아이콘을 만드는 중입니다...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-shortcut.ps1"
if not errorlevel 1 goto DONE

echo.
echo  첫 번째 방식이 실패해 다른 방식으로 다시 시도합니다...
echo.
cscript //nologo "%~dp0tools\make-shortcut.vbs"
if not errorlevel 1 goto DONE
goto MANUAL

:NOTOOLS
echo  [오류] 프로그램 파일을 찾을 수 없습니다.
echo.
echo  ZIP 파일 안에서 바로 실행하신 것 같습니다.
echo  1. ZIP 파일을 오른쪽 클릭 - [모두 압축 풀기]로 압축을 풉니다.
echo  2. 풀린 폴더 안의 make-desktop-icon.bat 을 다시 실행해 주세요.
echo.
pause
exit /b 1

:MANUAL
echo.
echo  [안내] 자동으로 아이콘을 만들지 못했습니다.
echo  보안 프로그램이 막았을 수 있습니다. 아래처럼 직접 만들 수 있습니다.
echo.
echo  1. 이 폴더의 start-blog-tool.bat 을 마우스 오른쪽 클릭
echo  2. 윈도우 11은 [추가 옵션 표시] 클릭
echo  3. [보내기] - [바탕 화면에 바로 가기 만들기]
echo.
echo  위 화면의 오류 내용을 캡처해 알려 주시면 고쳐 드리겠습니다.
echo.
pause
exit /b 1

:DONE
echo.
echo  완료되었습니다. 바탕화면에 '블로그 글 도우미' 아이콘이 생겼습니다.
echo  아이콘이 안 보이면 바탕화면을 한 번 클릭하고 F5 키를 눌러 주세요.
echo.
pause
exit /b 0
