@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   RoomManager - khoi tao de DUNG THAT
echo  ==========================================
echo.
echo  Buoc nay XOA SACH moi thu trong co so du lieu tren may nay,
echo  ke ca du lieu mau lan tai khoan mau, roi de trong hoan toan
echo  de ban tu nhap nha, phong va khach thue that.
echo.
echo  Sau do ban tao tai khoan chu nha rieng bang mat khau cua minh.
echo.

curl -s -o nul --max-time 3 http://localhost:3000/login
if errorlevel 1 (
  echo  [LOI] Server chua chay. Chay start.bat truoc roi thu lai.
  echo.
  pause
  exit /b 1
)

set /p CONFIRM="  Go 'dung that' roi Enter de xac nhan: "
if /i not "%CONFIRM%"=="dung that" (
  echo.
  echo  Da huy, khong thay doi gi.
  echo.
  pause
  exit /b 0
)

echo.
echo  Dang dung bang va xoa sach du lieu...
curl -s -X POST "http://localhost:3000/api/dev/setup?empty=true" >nul
if errorlevel 1 (
  echo  [LOI] Khong goi duoc server. Xem cua so dang chay start.bat.
  pause
  exit /b 1
)
rem Danh dau may nay dang chua du lieu that, de start.bat khong nap du lieu mau.
echo Du lieu that - khong nap du lieu mau vao co so du lieu nay.> ".du-lieu-that"
echo  Xong. Co so du lieu dang trong.

echo.
echo  ==========================================
echo   Tai khoan chu nha cua ban
echo  ==========================================
echo.
set "OWNER_EMAIL="
set "OWNER_NAME="
set "OWNER_PASS="
set "OWNER_PHONE="
set /p OWNER_EMAIL="  Email hoac ten dang nhap: "
set /p OWNER_NAME="  Ho ten: "
set /p OWNER_PASS="  Mat khau (it nhat 8 ky tu): "
set /p OWNER_PHONE="  So dien thoai (bo trong cung duoc): "

echo.
echo  Dang tao tai khoan...
curl -s -X POST http://localhost:3000/api/dev/create-owner ^
  -H "content-type: application/json; charset=utf-8" ^
  -d "{\"email\":\"!OWNER_EMAIL!\",\"fullName\":\"!OWNER_NAME!\",\"password\":\"!OWNER_PASS!\",\"phone\":\"!OWNER_PHONE!\"}" ^
  -o "%TEMP%\rm-owner.json" -w "%%{http_code}" > "%TEMP%\rm-owner-code.txt"
set /p HTTP_CODE=<"%TEMP%\rm-owner-code.txt"
del "%TEMP%\rm-owner-code.txt" >nul 2>&1

set "OWNER_PASS="

if not "!HTTP_CODE!"=="201" (
  echo.
  echo  [LOI] Khong tao duoc tai khoan. Server tra ve:
  type "%TEMP%\rm-owner.json"
  echo.
  echo.
  echo  Co so du lieu van dang trong. Chay lai file nay de thu lai.
  del "%TEMP%\rm-owner.json" >nul 2>&1
  pause
  exit /b 1
)
del "%TEMP%\rm-owner.json" >nul 2>&1

echo.
echo  ==========================================
echo   Xong. Bat dau dung that duoc roi.
echo  ==========================================
echo.
echo  Dang nhap tai http://localhost:3000 bang:  !OWNER_EMAIL!
echo.
echo  Nen lam ngay sau khi dang nhap:
echo    - Bat xac thuc hai buoc o trang Cai dat.
echo    - Tao them mot tai khoan chu nha thu hai, phong khi quen mat khau.
echo.
echo  Tu gio DUNG chay reset-data.bat nua - no xoa sach du lieu that.
echo.
start "" http://localhost:3000/login
pause
exit /b 0
