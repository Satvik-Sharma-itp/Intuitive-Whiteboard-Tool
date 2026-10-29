@echo off
rem Starts the whiteboard (double-click this file). Extra options are passed on, e.g.  start.bat --port 9000
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py run.py %*
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        python run.py %*
    ) else (
        echo Python 3.8 or newer was not found. Install it from https://www.python.org/downloads/
        echo and tick "Add python.exe to PATH" in the installer, then run this file again.
    )
)
pause
