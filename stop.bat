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

REM Also try to kill any lingering node processes on the common ports
echo      Cleaning up any lingering Node processes...
taskkill /F /IM node.exe >nul 2>&1

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
