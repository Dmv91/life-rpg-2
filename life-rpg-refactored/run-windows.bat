@echo off
setlocal
cd /d "%~dp0"
title Life RPG - Local SQLite Server

echo ========================================
echo   Life RPG - Local Server + SQLite
echo ========================================
echo.

where py >nul 2>nul
if %errorlevel%==0 goto use_py
where python >nul 2>nul
if %errorlevel%==0 goto use_python

echo ERROR: Python 3 was not found.
echo Install Python from https://www.python.org/downloads/windows/
echo During installation, enable "Add Python to PATH".
echo.
pause
exit /b 1

:use_py
echo Starting with Python launcher...
py -3 --version
if errorlevel 1 goto python_error
start "Life RPG" http://localhost:8000
py -3 server.py
goto server_stopped

:use_python
echo Starting with Python command...
python --version
if errorlevel 1 goto python_error
start "Life RPG" http://localhost:8000
python server.py
goto server_stopped

:python_error
echo Python was found but could not run. Reinstall Python 3 and enable Add Python to PATH.
pause
exit /b 1

:server_stopped
echo.
echo The Life RPG server has stopped.
pause
