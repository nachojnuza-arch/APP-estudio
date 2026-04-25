@echo off
chcp 65001 > nul
echo.
echo ======================================================
echo     Iniciando servidor web local para Apuntes...
echo ======================================================
echo.
echo    - Tu aplicacion estara disponible en: http://localhost:8003
echo.
echo    - Cuando termines, cierra esta ventana o presiona
echo      Ctrl+C para detener el servidor.
echo.
echo ======================================================
echo.

python -m http.server 8003

pause
