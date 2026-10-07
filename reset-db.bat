@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
echo ============================================
echo VAPT Command Center - Reset Application
echo ============================================
echo.

REM Usage:  reset-db.bat                         (interactive menu)
REM         reset-db.bat --scopes "users,projects" --yes
REM         reset-db.bat --scopes everything --confirm RESET
REM         reset-db.bat --dry-run               (show what would be deleted, change nothing)
REM         --no-start                           (do not start the dev servers afterwards)
REM Quote comma-separated values: batch splits unquoted commas into separate arguments.
set "NO_START=0"
set "RESET_ARGS="
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-start" (
    set "NO_START=1"
) else (
    set RESET_ARGS=!RESET_ARGS! %1
)
shift
goto parse_args
:args_done

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

REM Stop the app first so nothing writes to the database/storage while it is being reset.
echo [4/6] Stopping any existing servers on ports 3000 and 4000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4000') do (
    echo      Killing process on port 4000 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo      Killing process on port 3000 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM Menu, confirmation, DB reset, storage cleanup and default restore (accounts + vulnerability DB)
REM all happen in prisma\reset-db.ts. It does not use `prisma db seed`: seeding only adds data.
echo [5/6] Reset Application...
echo.
call npx ts-node --transpile-only prisma/reset-db.ts !RESET_ARGS!
set "RESET_EXIT=!errorlevel!"
if not "!RESET_EXIT!"=="0" (
    echo.
    if "!RESET_EXIT!"=="2" (
        echo Cancelled - nothing was changed. Servers were not started.
    ) else (
        echo [ERROR] Reset did not complete. See the stage reported above. Servers were not started.
    )
    cd ..\..
    pause
    exit /b !RESET_EXIT!
)

if "!NO_START!"=="1" (
    cd ..\..
    echo.
    echo Reset complete. Servers not started ^(--no-start^).
    exit /b 0
)

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
echo Reset complete + Servers Started!
echo ============================================
echo.
echo Services:
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:4000
echo   Swagger:   http://localhost:4000/api/docs
echo.
echo If users were reset, default logins (must change password on first login):
echo   admin / Admin@1234567890!   teamlead / Tl@1234567890!
echo   tester1, tester2 / Tester@1234567890!
echo.
echo NOTE: Wait ~10 seconds for both servers to fully start.
echo       Check the two new terminal windows for ready messages.
echo.
pause
