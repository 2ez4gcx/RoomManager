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
echo  Chi dung toi co so du lieu cua start.bat, noi luon luon chi chua
echo  du lieu mau. So lieu that cua chay-server.bat nam o cho khac,
echo  lenh nay khong cham toi.
echo.

curl -s -o nul --max-time 3 http://localhost:3000/login
if errorlevel 1 (
  echo  [LOI] Server chua chay. Chay start.bat truoc roi thu lai.
  echo.
  pause
  exit /b 1
)

rem Xoa truoc khi hoi: set /p khong doc duoc thi bien phai rong,
rem de cau so sanh ben duoi roi vao nhanh huy chu khong phai nhanh xoa sach du lieu.
set "CONFIRM="
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
echo.
echo.
echo  Xong. Tai lai trang trong trinh duyet de thay du lieu moi.
echo.
pause
exit /b 0
