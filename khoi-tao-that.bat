@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   RoomManager - khoi tao de DUNG THAT
echo  ==========================================
echo.
echo  Tao co so du lieu that, trong hoan toan, va tai khoan chu nha
echo  cua ban. Sau do dung chay-server.bat de chay hang ngay.
echo.
echo  Khong dung chung du lieu voi start.bat. start.bat chi de xem thu
echo  bang du lieu mau, chay bao nhieu lan cung khong anh huong gi den
echo  so lieu that.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Khong tim thay Node.js. Cai tai https://nodejs.org roi chay lai.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo  Cai thu vien lan dau, mat vai phut...
  call npm install
  if errorlevel 1 (
    echo  [LOI] npm install that bai.
    pause
    exit /b 1
  )
)

if not exist "dist\server\index.js" (
  echo  Dang build ban production...
  call npm run build
  if errorlevel 1 (
    echo  [LOI] Build that bai.
    pause
    exit /b 1
  )
)

rem Node doc UTF-8 tu console dung, nen o day go tieng Viet co dau thoai mai -
rem khac han set /p cua batch. Toan bo phan hoi thoai nam trong script Node.
node scripts/chay-server.mjs --khoi-tao
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo  Buoc tiep theo: nhap dup chay-server.bat de chay server.
echo.
pause
exit /b 0
