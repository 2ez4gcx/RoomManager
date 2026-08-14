@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo  ==========================================
echo   RoomManager - nap lai du lieu mau
echo  ==========================================
echo.
echo  Thao tac nay XOA SACH du lieu trong co so du lieu local
echo  roi nap lai bo mau: 2 nha, 40 phong, 32 hop dong, 32 don thu.
echo.
echo  *** CANH BAO ***
echo  Neu ban dang dung that, lenh nay se XOA HET du lieu that
echo  va thay bang du lieu mau. Khong the hoan tac.
echo  Muon khoi tao trong de nhap du lieu that thi dung khoi-tao-that.bat.
echo.

curl -s -o nul --max-time 3 http://localhost:3000/login
if errorlevel 1 (
  echo  [LOI] Server chua chay. Chay start.bat truoc roi thu lai.
  echo.
  pause
  exit /b 1
)

set /p CONFIRM="  Go 'xoa' roi Enter de xac nhan: "
if /i not "%CONFIRM%"=="xoa" (
  echo.
  echo  Da huy, khong thay doi gi.
  echo.
  pause
  exit /b 0
)

echo.
echo  Dang nap lai...
curl -s -X POST "http://localhost:3000/api/dev/setup?reset=true"
if exist ".du-lieu-that" del ".du-lieu-that"
echo.
echo.
echo  Xong. Tai lai trang trong trinh duyet de thay du lieu moi.
echo.
pause
exit /b 0
