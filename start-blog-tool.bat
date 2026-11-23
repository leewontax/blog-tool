@echo off
cd /d "%~dp0"
if not exist "%~dp0tools\launch.ps1" goto NOTOOLS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1"
if errorlevel 1 goto FAIL
exit /b 0

:NOTOOLS
echo.
echo  [오류] 프로그램 파일을 찾을 수 없습니다.
echo  ZIP 파일의 압축을 먼저 푼 뒤, 풀린 폴더에서 실행해 주세요.
echo.
pause
exit /b 1

:FAIL
echo.
echo  [안내] 프로그램을 시작하지 못했습니다. 위 내용을 캡처해 알려 주세요.
echo  명령어로 실행하려면 이 폴더에서 npm start 를 입력해도 됩니다.
echo.
pause
exit /b 1
