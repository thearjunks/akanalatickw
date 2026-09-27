@echo off
setlocal

set "APP_DIR=%~dp0.."
set "APP_URL=http://127.0.0.1:4777/"
set "HEALTH_URL=http://127.0.0.1:4777/api/health"

cd /d "%APP_DIR%"

powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  if not exist "node_modules" (
    echo Installing application dependencies...
    call npm.cmd install
    if errorlevel 1 goto :error
  )

  echo Starting GA4 Event Dashboard...
  start "GA4 Event Dashboard Server" /min /D "%APP_DIR%" cmd.exe /c npm.cmd start

  powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); do { try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
  if errorlevel 1 goto :error
)

echo Opening dashboard in Google Chrome...
where chrome.exe >nul 2>nul
if not errorlevel 1 (
  start "" chrome.exe "%APP_URL%"
  goto :done
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  goto :done
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  goto :done
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  goto :done
)

echo Google Chrome was not found. Open this URL manually:
echo %APP_URL%
pause
exit /b 1

:error
echo.
echo The application could not be started. Review the server window for details.
pause
exit /b 1

:done
endlocal
exit /b 0
