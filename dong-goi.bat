@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo   RoomManager - dong goi de gui khach hang
echo  ==========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Khong tim thay git tren may.
  echo  Xem cach dong goi thu cong o docs\BAN-GIAO.md
  echo.
  pause
  exit /b 1
)

rem git archive chi lay file dang duoc git theo doi, nen khong the vo tinh
rem goi kem .wrangler (du lieu khach thue), .git hay .env.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  [LOI] Thu muc nay khong phai kho ma git.
  pause
  exit /b 1
)

for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
set "OUT=RoomManager-!TODAY!.zip"

git status --porcelain > "%TEMP%\rm-dirty.txt"
for %%f in ("%TEMP%\rm-dirty.txt") do set DIRTY=%%~zf
del "%TEMP%\rm-dirty.txt" >nul 2>&1
if not "!DIRTY!"=="0" (
  echo  [CANH BAO] Dang co thay doi chua commit.
  echo  Goi chi chua nhung gi da commit, phan sua moi se KHONG co trong goi.
  echo.
  set /p GOON="  Van dong goi? (c/k): "
  if /i not "!GOON!"=="c" (
    echo  Da huy.
    pause
    exit /b 0
  )
  echo.
)

echo  Dang tao !OUT! ...
git archive --format=zip HEAD -o "!OUT!"
if errorlevel 1 (
  echo  [LOI] Dong goi that bai.
  pause
  exit /b 1
)

echo.
echo  Dang kiem tra goi khong chua du lieu rieng...
rem Goi chua dung nhung file git dang theo doi, nen kiem tra danh sach do la du.
git ls-files > "%TEMP%\rm-files.txt"
findstr /b /i /c:".wrangler/" /c:".env" /c:"node_modules/" "%TEMP%\rm-files.txt" > "%TEMP%\rm-bad.txt"
for %%f in ("%TEMP%\rm-bad.txt") do set BADSIZE=%%~zf
if not "!BADSIZE!"=="0" (
  echo  [LOI] Goi chua file khong duoc phep:
  type "%TEMP%\rm-bad.txt"
  echo.
  echo  Dung gui goi nay. Xem docs\BAN-GIAO.md
  del "%TEMP%\rm-files.txt" "%TEMP%\rm-bad.txt" >nul 2>&1
  del "!OUT!" >nul 2>&1
  pause
  exit /b 1
)
del "%TEMP%\rm-files.txt" "%TEMP%\rm-bad.txt" >nul 2>&1
echo  Goi sach.

for %%f in ("!OUT!") do set /a SIZE_KB=%%~zf/1024
echo.
echo  ==========================================
echo   Xong: !OUT!  (!SIZE_KB! KB)
echo  ==========================================
echo.
echo  Truoc khi gui, nen giai nen ra thu muc khac va chay thu start.bat.
echo  Huong dan danh cho khach nam san trong goi:
echo    docs\HUONG-DAN-CAI-DAT.md
echo.
pause
exit /b 0
