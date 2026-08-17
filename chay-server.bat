@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   RoomManager - chay nhu mot server
echo  ==========================================
echo.
echo  Khac start.bat o hai diem:
echo    - Chay ban build production, nen nhom route /api/dev/ bi khoa.
echo    - Mo ra mang noi bo, dien thoai trong cung wifi vao duoc.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Khong tim thay Node.js. Cai tai https://nodejs.org roi chay lai.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo  [1/3] Cai thu vien lan dau, mat vai phut...
  call npm install
  if errorlevel 1 (
    echo  [LOI] npm install that bai.
    pause
    exit /b 1
  )
) else (
  echo  [1/3] Thu vien da co san.
)

rem Build lai moi lan. Mat khoang mot phut, doi lai la khong bao gio chay nham
rem ban build cu sau khi cap nhat ma nguon.
echo  [2/3] Dang build ban production...
call npm run build
if errorlevel 1 (
  echo.
  echo  [LOI] Build that bai. Xem thong bao o tren.
  pause
  exit /b 1
)

if not exist ".wrangler\state\server\" (
  echo.
  echo  ==========================================
  echo   Chua co co so du lieu cho che do server
  echo  ==========================================
  echo.
  echo  Chay lenh sau de tao, no se hoi email va mat khau chu nha:
  echo.
  echo    npm run server:khoi-tao
  echo.
  echo  Xong roi thi chay lai file nay.
  echo.
  pause
  exit /b 0
)

echo  [3/3] Dang khoi dong server...
echo.
echo  Dong cua so nay hoac nhan Ctrl+C de dung.
echo.
node scripts/chay-server.mjs

echo.
echo  Server da dung.
pause
exit /b 0
