@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Script tu goi lai chinh no o che do --open de cho server len roi mo trinh duyet.
if /i "%~1"=="--open" goto wait_and_open

echo.
echo  ==========================================
echo   RoomManager - chay ban localhost
echo  ==========================================
echo.

rem --- Kiem tra Node.js ---------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Khong tim thay Node.js tren may.
  echo  Cai dat Node.js 22.13 tro len tai https://nodejs.org roi chay lai file nay.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 22 (
  echo  [LOI] Du an can Node.js 22.13 tro len.
  echo  Phien ban dang cai:
  node -v
  echo.
  pause
  exit /b 1
)

rem --- Server da chay san thi chi mo trinh duyet --------------------------
curl -s -o nul --max-time 3 http://localhost:3000/login
if not errorlevel 1 (
  echo  Server dang chay san tai http://localhost:3000
  echo  Dang mo trinh duyet...
  start "" http://localhost:3000/login
  echo.
  echo  Muon khoi dong lai thi dong cua so dang chay server truoc.
  echo.
  pause
  exit /b 0
)

rem --- Cai thu vien lan dau -----------------------------------------------
if not exist "node_modules\" (
  echo  [1/3] Cai thu vien lan dau, buoc nay mat vai phut...
  call npm install
  if errorlevel 1 (
    echo.
    echo  [LOI] npm install that bai. Kiem tra ket noi mang roi thu lai.
    pause
    exit /b 1
  )
) else (
  echo  [1/3] Thu vien da co san, bo qua npm install.
)

rem --- Tien trinh phu: cho server len, nap du lieu mau, mo trinh duyet ----
echo  [2/3] Se tu mo trinh duyet khi server san sang.
start "RoomManager - mo trinh duyet" /min "%~f0" --open

rem --- Chay server o cua so nay -------------------------------------------
echo  [3/3] Dang khoi dong server...
echo.
if exist ".du-lieu-that" (
  echo  Che do DUNG THAT: dang nhap bang tai khoan cua ban.
) else (
  echo  Du lieu mau. Dang nhap:  quanly@hoangan.vn / roommanager
  echo  Muon nhap du lieu that thi chay khoi-tao-that.bat
)
echo  Dong cua so nay hoac nhan Ctrl+C de dung server.
echo.
call npm run dev

echo.
echo  Server da dung.
pause
exit /b 0


rem ========================================================================
rem  Che do --open: cho toi khi server tra loi, dung du lieu mau neu chua co
rem ========================================================================
:wait_and_open
set /a TRIES=0

:poll
set /a TRIES+=1
rem Cho toi da khoang 120 giay (60 lan x 2 giay)
if !TRIES! GTR 60 goto give_up

curl -s -o nul --max-time 3 http://localhost:3000/login
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto poll
)

rem Dung bang va nap du lieu mau. Neu da co du lieu, route nay tu bo qua.
rem File .du-lieu-that danh dau may nay dang chua du lieu that: khong duoc
rem nap du lieu mau vao, ke ca khi co so du lieu dang trong.
if exist ".du-lieu-that" (
  curl -s -X POST "http://localhost:3000/api/dev/setup?migrate=true" >nul 2>&1
) else (
  curl -s -X POST http://localhost:3000/api/dev/setup >nul 2>&1
)

start "" http://localhost:3000/login
exit /b 0

:give_up
echo  Cho qua lau ma server chua len. Xem loi o cua so con lai.
timeout /t 8 /nobreak >nul
exit /b 1
