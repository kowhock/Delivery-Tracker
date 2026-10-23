@echo off
rem Started by Windows Task Scheduler at startup: syncs AutoCount SO/DO into Supabase every 5 minutes.
rem First gets the latest code from GitHub, so restarting the computer (or the task) picks up changes.
rem Output goes to autocount-sync.log in the project folder.
cd /d "%~dp0.."
echo ===== %date% %time% starting >> autocount-sync.log
git pull --ff-only >> autocount-sync.log 2>&1 || echo Could not update from GitHub, running the code already here >> autocount-sync.log
call npm install --no-audit --no-fund >> autocount-sync.log 2>&1
call npm run autocount:sync >> autocount-sync.log 2>&1
