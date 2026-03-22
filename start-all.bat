@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "API_DIR=!ROOT!artifacts\api-server"
set "LANDING_DIR=!ROOT!artifacts\bevpro-landing"
set "PWA_DIR=!ROOT!artifacts\voice-agent-pwa"
set "EXPO_DIR=!ROOT!artifacts\square-voice-agent"
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

set "VOICE_TARGET=pwa"
if /i "%~1"=="expo" set "VOICE_TARGET=expo"

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

echo Starting API server on http://localhost:8080
start "Square Voice API" /D "!API_DIR!" cmd /k "call pnpm run dev:local"

echo Starting dashboard on http://localhost:5173
start "Bevpro Landing" /D "!LANDING_DIR!" cmd /k "call pnpm run dev"

if /i "!VOICE_TARGET!"=="expo" (
  echo Starting Expo voice app on http://localhost:8081
  start "Square Voice Expo" /D "!EXPO_DIR!" cmd /k "call pnpm run dev"
) else (
  echo Starting voice-agent PWA on http://localhost:8081
  start "Square Voice PWA" /D "!PWA_DIR!" cmd /k "call pnpm run dev"
)

echo.
echo Started local services in separate windows.
echo Default client: PWA on http://localhost:8081
echo Optional Expo client: run start-all.bat expo
exit /b 0