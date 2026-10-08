@echo off
setlocal
title Windows 10 Speedup
cd /d "%~dp0"

rem --- Adminrechte anfordern ---------------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Fordere Administratorrechte an ...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

rem --- Downloads entsperren (Mark-of-the-Web) ------------------------------
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse | Unblock-File" >nul 2>&1

:menu
cls
echo ==============================================
echo    Windows 10 Speedup
echo ==============================================
echo.
echo    [1] Auswahlmenue (empfohlen)
echo    [2] Nur schnelle Suche (Everything + Taskleiste)
echo    [3] Alles automatisch, ohne Rueckfragen (Max)
echo    [4] Alles rueckgaengig machen
echo    [Q] Beenden
echo.
choice /c 1234Q /n /m "Auswahl: "
if errorlevel 5 goto :end
if errorlevel 4 goto :undo
if errorlevel 3 goto :auto
if errorlevel 2 goto :search
if errorlevel 1 goto :full

:full
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Win10-Speedup.ps1" -Mode Max
goto :menu

:search
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Win10-Speedup.ps1" -OnlySearch
goto :menu

:auto
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Win10-Speedup.ps1" -Mode Max -NoMenu
pause
goto :menu

:undo
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Win10-Speedup.ps1" -Undo
goto :menu

:end
endlocal
