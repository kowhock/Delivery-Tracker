@echo off
rem Started by Windows Task Scheduler at startup: syncs AutoCount SO/DO into Supabase every 5 minutes.
rem Output goes to autocount-sync.log in the project folder.
cd /d "%~dp0.."
call npm run autocount:sync >> autocount-sync.log 2>&1
