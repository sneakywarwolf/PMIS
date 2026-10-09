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

REM Apply pending DB migrations and regenerate the Prisma client BEFORE the backend starts,
REM otherwise code that expects newer tables/columns fails at runtime.
echo Applying database migrations...
pushd apps\backend
call npx prisma generate
if errorlevel 1 (
    echo [ERROR] prisma generate failed. Is a backend still running? Run stop.bat first.
    popd
    pause
    exit /b 1
)
call npx prisma migrate deploy
if errorlevel 1 (
    echo [ERROR] Database migration failed. Check the error above.
    popd
    pause
    exit /b 1
)
popd

REM Production builds: next dev / nest --watch compile per request and crash under several simultaneous users.
echo Building backend and frontend (first run takes a few minutes)...
call npm run build --prefix appsackend
if errorlevel 1 (
    echo [ERROR] Backend build failed.
    pause
    exit /b 1
)
call npm run build --prefix appsrontend
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)

REM Start backend in a minimized window, logs to backend.log
start /min "VAPT Backend" cmd /c "cd apps\backend && npm run start:prod > backend.log 2>&1"

REM Start frontend in a minimized window, logs to frontend.log
start /min "VAPT Frontend" cmd /c "cd apps\frontend && set NODE_OPTIONS=--max-old-space-size=2048 && npm run start > frontend.log 2>&1"

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
