@echo off
setlocal

rem Double-click this file to start the app on your computer.
rem It wipes the leftover build files, frees the port, and starts fresh.
rem That is what stops an old page from getting stuck on screen.

cd /d "%~dp0"

echo.
echo === Clearing old build files (.next) ===
if exist .next (
    rmdir /s /q .next
    echo     Done. This makes startup a bit slower, but stops old pages sticking around.
) else (
    echo     Nothing to clear.
)

echo.
echo === Freeing up port 3000 ===
set "foundport=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do (
    set /a foundport=1
    taskkill /f /pid %%p >nul 2>&1
)
if "%foundport%"=="0" (
    echo     Nothing was using it.
) else (
    echo     Freed up.
)

echo.
echo === Starting the app ===
echo     Leaving this window open keeps it running.
echo     Closing this window stops it.
echo     It will open in your browser in a few seconds.
echo.

start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"

call npm run dev

echo.
echo === The server stopped ===
echo Check the messages above for the reason.
pause
