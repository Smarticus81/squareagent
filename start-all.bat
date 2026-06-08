@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "API_DIR=!ROOT!artifacts\api-server"
set "LANDING_DIR=!ROOT!artifacts\voycelab-landing"
set "PWA_DIR=!ROOT!artifacts\voice-agent-pwa"
cd /d "%ROOT%"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is required but was not found in PATH.
  echo Install pnpm first, then run this script again.
  exit /b 1
)

if not exist "!ROOT!node_modules" (
  echo Installing workspace dependencies...
  call pnpm install
  if errorlevel 1 exit /b 1
)

if not exist "!ROOT!.env" (
  echo Warning: !ROOT!.env was not found.
  echo The API server may fail until you add the required environment variables.
  echo.
) else (
  echo Ensuring database tables exist...
  call node --env-file="!ROOT!.env" "!ROOT!lib\db\create-tables.cjs"
  if errorlevel 1 (
    echo Database bootstrap failed. Auth and venue routes may error until DATABASE_URL is fixed.
    echo.
  )
)

echo Checking development ports and clearing stale Node listeners...
powershell -NoProfile -Command "$ports = @(8080, 8081, 5173, 5174, 5175); foreach ($p in $ports) { $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host ('Port ' + $p + ' is free'); continue }; $handled = $false; $owners = $conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) { $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped node PID ' + $owner + ' on port ' + $p); $handled = $true } else { $name = if ($proc) { $proc.ProcessName } else { 'unknown' }; Write-Host ('Port ' + $p + ' is used by non-node process ' + $name + ' (PID ' + $owner + ')') } }; if ($handled) { Write-Host ('Port ' + $p + ' is ready') } }"
echo.

echo Starting API server on http://localhost:8080
start "Square Voice API" /D "!API_DIR!" cmd /k "call pnpm run dev:local"

echo Starting dashboard on http://localhost:5173
start "VoyceLab Landing" /D "!LANDING_DIR!" cmd /k "call pnpm run dev"

echo Starting voice-agent PWA on http://localhost:8081
start "Square Voice PWA" /D "!PWA_DIR!" cmd /k "call pnpm run dev"

echo.
echo Started local services in separate windows.
echo   API:       http://localhost:8080
echo   Dashboard: http://localhost:5173
echo   PWA:       http://localhost:8081
exit /b 0
