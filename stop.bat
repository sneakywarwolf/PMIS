@echo off
chcp 65001 >nul
echo ============================================
echo VAPT Command Center - Stop
echo ============================================
echo.

REM Stop development servers
echo [1/2] Stopping development servers...

taskkill /F /FI "WINDOWTITLE eq VAPT Backend*" >nul 2>&1
if errorlevel 1 (
    echo      Backend server not running or already stopped.
) else (
    echo      Backend server stopped.
)

taskkill /F /FI "WINDOWTITLE eq VAPT Frontend*" >nul 2>&1
if errorlevel 1 (
    echo      Frontend server not running or already stopped.
) else (
    echo      Frontend server stopped.
)

REM Free the dev ports (covers servers started without a titled window, e.g. start.bat's
REM minimized ones). Only the processes listening on 3000/4000 and their children are killed -
REM never every node.exe, which would also kill unrelated Node apps and tools.
echo      Freeing ports 3000 and 4000...
for %%P in (3000 4000) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
        taskkill /F /T /PID %%a >nul 2>&1
    )
)

echo.
echo [2/2] Stopping Docker containers...
docker-compose down

echo.
echo ============================================
echo All Stopped!
echo ============================================
echo.
echo   Docker containers stopped.
echo   Dev servers stopped.
echo.
echo To start again, run: start.bat
echo To do a full reset, run: setup.bat
echo.
pause
