@echo off
title MFP Giveaway Bot Deploy Script
echo ==========================================
echo MFP Giveaway Bot - Git Deploy
echo ==========================================

:: Step 1: Git Add
echo.
echo [1/3] Staging changes...
git add .
if errorlevel 1 (
    echo ❌ Git add failed!
    pause
    exit /b 1
)
echo ✅ Changes staged

:: Step 2: Git Commit
echo.
set /p msg="[2/3] Enter commit message (or press Enter for default): "
if "%msg%"=="" (
    set msg="Bot update - automated deploy"
)
git commit -m "%msg%"
if errorlevel 1 (
    echo ❌ Git commit failed! (nothing to commit?)
    pause
    exit /b 1
)
echo ✅ Commit complete: %msg%

:: Step 3: Git Push
echo.
echo [3/3] Pushing to remote...
git push
if errorlevel 1 (
    echo ❌ Git push failed!
    echo Make sure you have push permissions and remote is configured
    pause
    exit /b 1
)
echo ✅ Push successful!

echo.
echo ==========================================
echo 🎉 Deployment complete!
echo ==========================================
echo.
echo 📝 Reminder: 
echo "   - Set Telegram env vars on Render dashboard"
echo "   - Monitor Render logs for bot startup"
echo.
pause