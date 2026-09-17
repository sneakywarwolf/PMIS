@echo off
chcp 65001 >nul
echo ============================================
echo VAPT Command Center - Start (Silent Mode)
echo ============================================
echo.

REM Check if Docker is running
docker ps >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Start infrastructure
echo [1/3] Starting Docker infrastructure...
docker-compose up -d

echo [2/3] Waiting for services to start...
timeout /t 5 /nobreak >nul

REM Sync dependencies (fast no-op if already up to date; catches stale/missing packages)
echo [3/3] Syncing dependencies and starting development servers (silent mode)...
call npm install --prefix apps\backend
if errorlevel 1 (
    echo [ERROR] Backend npm install failed. Check error above.
    pause
    exit /b 1
)
call npm install --prefix apps\frontend
if errorlevel 1 (
    echo [ERROR] Frontend npm install failed. Check error above.
    pause
    exit /b 1
)

REM Start backend in a minimized window, logs to backend.log
start /min "VAPT Backend" cmd /c "cd apps\backend && npm run start:dev > backend.log 2>&1"

REM Start frontend in a minimized window, logs to frontend.log
start /min "VAPT Frontend" cmd /c "cd apps\frontend && npm run dev > frontend.log 2>&1"

echo.
echo ============================================
echo Servers Started in Background!
echo ============================================
echo.
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:4000
echo   Swagger:   http://localhost:4000/api/docs
echo   MinIO:     http://localhost:9001
echo.
echo   Logs:      backend.log  ^|  frontend.log
echo.
echo NOTE: Wait ~10 seconds for servers to fully start.
echo       Check the log files if something seems wrong.
echo.
echo To stop:        stop.bat
echo To debug mode:  start-dev.bat
echo.
pause
