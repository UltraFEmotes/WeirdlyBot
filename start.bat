@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || (major===22 && minor>=12) ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
    echo WeirdlyBot requires Node.js 22.12 or newer. Install it and try again.
    pause
    exit /b 1
)

if not exist config.yaml (
    echo Copy config.yaml.example to config.yaml and follow the README setup first.
    pause
    exit /b 1
)

echo Installing dependencies...
npm install
if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

echo Starting WeirdlyBot...
npm start
