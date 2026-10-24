@echo off
chcp 65001 >nul
echo ============================================
echo VAPT Command Center - Start (Debug Mode)
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
docker compose -f docker-compose.dev.yml up -d --wait

echo [2/3] Waiting for services to start...
timeout /t 5 /nobreak >nul

REM Sync dependencies (fast no-op if already up to date; catches stale/missing packages)
echo [3/3] Syncing dependencies and starting development servers (debug mode)...
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

REM Start backend in a normal terminal window with full output
start "VAPT Backend" cmd /k "cd apps\backend && npm run start:dev"

REM Start frontend in a normal terminal window with full output
start "VAPT Frontend" cmd /k "cd apps\frontend && npm run dev"

echo.
echo ============================================
echo Servers Starting in Debug Mode!
echo ============================================
echo.
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:4000
echo   Swagger:   http://localhost:4000/api/docs
echo   RustFS console: http://localhost:9001
echo.
echo NOTE: Wait ~10 seconds for servers to fully start.
echo       Watch the terminal windows for logs and errors.
echo.
echo To stop:        stop.bat
echo To silent mode: start.bat
echo.
pause
