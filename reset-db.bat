@echo off
chcp 65001 >nul
echo ============================================
echo VAPT Command Center - Reset DB + Start Servers
echo ============================================
echo.

REM Check if Docker is running
docker ps >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Please start Docker Desktop first.
    exit /b 1
)

REM Start infrastructure (in case containers are stopped)
echo [1/6] Ensuring Docker services are running...
docker-compose up -d
timeout /t 5 /nobreak >nul

cd apps\backend

echo [2/6] Syncing backend dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Backend npm install failed. Check error above.
    pause
    exit /b 1
)

echo [3/6] Generating Prisma client + applying migrations...
call npx prisma generate
call npx prisma migrate deploy
if errorlevel 1 (
    echo [ERROR] Migration failed. Try running setup.bat --clean instead.
    pause
    exit /b 1
)

echo [4/6] Seeding database with default users...
call npx prisma db seed
if errorlevel 1 (
    echo [ERROR] Seed failed.
    pause
    exit /b 1
)

echo [5/6] Stopping any existing servers on ports 3000 and 4000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4000') do (
    echo      Killing process on port 4000 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo      Killing process on port 3000 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [6/6] Starting servers...
echo      Starting backend server on port 4000...
start "VAPT Backend" cmd /k "npm run start:dev"

cd ..\..
cd apps\frontend
echo      Starting frontend server on port 3000...
start "VAPT Frontend" cmd /k "npm run dev"

cd ..\..

echo.
echo ============================================
echo Database Reset + Servers Started!
echo ============================================
echo.
echo Services:
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:4000
echo   Swagger:   http://localhost:4000/api/docs
echo.
echo Default Login:
echo   Username: admin
echo   Password: Admin@1234567890!
echo.
echo NOTE: Wait ~10 seconds for both servers to fully start.
echo       Check the two new terminal windows for ready messages.
echo.
pause
