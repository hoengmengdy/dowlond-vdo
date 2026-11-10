@echo off
setlocal
cd /d "%~dp0"
echo [1/3] Installing backend dependencies...
python -m pip install -q -r backend\requirements.txt || goto :err
echo [2/3] Building frontend...
pushd frontend
if not exist node_modules call npm install --no-audit --no-fund || goto :err
call npm run build || goto :err
popd
echo [3/3] Starting server on http://127.0.0.1:8765
start "" http://127.0.0.1:8765
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
goto :eof
:err
echo Setup failed.
exit /b 1
