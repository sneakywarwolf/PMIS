@echo off
chcp 65001 >nul
echo ============================================
echo VAPT Command Center - Setup Script
echo ============================================
echo.

REM Check if Docker is running
docker ps >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    exit /b 1
)

REM Check for --clean flag
set CLEAN=0
if "%~1"=="--clean" set CLEAN=1

if %CLEAN%==1 (
    echo [0/6] CLEAN MODE: Removing node_modules...
    if exist node_modules rmdir /s /q node_modules
    if exist package-lock.json del package-lock.json
    if exist apps\backend\node_modules rmdir /s /q apps\backend\node_modules
    if exist apps\backend\package-lock.json del apps\backend\package-lock.json
    if exist apps\frontend\node_modules rmdir /s /q apps\frontend\node_modules
    if exist apps\frontend\package-lock.json del apps\frontend\package-lock.json
    echo      Done.
) else (
    echo [0/6] FAST MODE: Keeping existing node_modules. Use --clean to force reinstall.
)

REM Start infrastructure
echo [1/6] Starting Docker infrastructure...
docker compose -f docker-compose.dev.yml up -d

REM Wait for services to be ready
echo [2/6] Waiting for services to start...
timeout /t 8 /nobreak >nul

REM Setup backend
echo [3/6] Setting up backend...
cd apps\backend

if not exist .env (
    copy ..\..\.env.dev.example .env
    echo      Created .env file from template
)

echo [4/6] Syncing backend dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Backend npm install failed. Check error above.
    pause
    exit /b 1
)

echo [5/6] Setting up database...
call npx prisma generate

REM Check if this is a fresh database or has existing migrations
FOR /F "tokens=*" %%g IN ('npx prisma migrate status 2^>^&1 ^| findstr "Database schema is up to date"') do (
    echo      Database already up to date. Skipping migrations.
    goto MIGRATIONS_DONE
)

REM Fresh database or pending migrations — use deploy for non-interactive apply
echo      Applying migrations...
call npx prisma migrate deploy
if errorlevel 1 (
    echo [WARN] migrate deploy failed, trying migrate dev...
    call npx prisma migrate dev --name init
)

:MIGRATIONS_DONE
echo      Seeding database...
call npx prisma db seed
if errorlevel 1 (
    echo [ERROR] Database seed failed. See error above.
    pause
    exit /b 1
)

echo [6/6] Starting backend server...
start "VAPT Backend" cmd /k "npm run start:dev"

cd ..\..

REM Setup frontend
echo Starting frontend setup...
cd apps\frontend

echo Syncing frontend dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Frontend npm install failed. Check error above.
    pause
    exit /b 1
)

echo Starting frontend server...
start "VAPT Frontend" cmd /k "npm run dev"

cd ..\..

echo.
echo ============================================
echo Setup Complete!
echo ============================================
echo.
echo Services:
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:4000
echo   Swagger:   http://localhost:4000/api/docs
echo   MinIO:     http://localhost:9001
echo.
echo Default Login:
echo   Username: admin
echo   Password: Admin@1234567890!
echo.
echo NOTE: Wait ~10 seconds for servers to fully start.
echo       Check the two new terminal windows for "running" messages.
echo.
pause
