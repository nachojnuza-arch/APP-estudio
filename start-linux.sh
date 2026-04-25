#!/bin/bash

# Script de inicio para Apuntes Facultad - Linux
# Este script inicia un servidor web local y abre el navegador

echo "🚀 Iniciando Apuntes Facultad..."
echo "=================================="

# Verificar si Python está instalado
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python3 no está instalado."
    echo "Por favor, instala Python3:"
    echo "  Ubuntu/Debian: sudo apt update && sudo apt install python3"
    echo "  CentOS/RHEL: sudo yum install python3"
    echo "  Arch Linux: sudo pacman -S python"
    exit 1
fi

# Verificar si estamos en el directorio correcto
if [ ! -f "index.html" ]; then
    echo "❌ Error: No se encontró index.html"
    echo "Por favor, ejecuta este script desde el directorio del proyecto"
    exit 1
fi

echo "✅ Python3 encontrado"
echo "📁 Directorio del proyecto: $(pwd)"

# Iniciar el servidor web
echo ""
echo "🌐 Iniciando servidor web local..."
echo "   Tu aplicación estará disponible en: http://localhost:8003"
echo ""
echo "   Para detener el servidor, presiona Ctrl+C"
echo "=================================="

# Iniciar servidor y abrir navegador
python3 -m http.server 8003 &
SERVER_PID=$!

# Esperar un momento para que el servidor inicie
sleep 2

# Intentar abrir el navegador
echo "📱 Abriendo navegador..."
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8003" 2>/dev/null &
elif command -v firefox &> /dev/null; then
    firefox "http://localhost:8003" 2>/dev/null &
elif command -v chrome &> /dev/null; then
    chrome "http://localhost:8003" 2>/dev/null &
elif command -v chromium &> /dev/null; then
    chromium "http://localhost:8003" 2>/dev/null &
else
    echo "⚠️  No se pudo abrir el navegador automáticamente"
    echo "   Por favor, abre tu navegador y ve a: http://localhost:8003"
fi

# Mantener el script en ejecución
echo ""
echo "✅ Servidor iniciado exitosamente!"
echo "   PID del servidor: $SERVER_PID"
echo ""
echo "   Cuando termines, presiona Ctrl+C para detener el servidor"
echo ""

# Función para limpiar al salir
cleanup() {
    echo ""
    echo "🛑 Deteniendo servidor..."
    kill $SERVER_PID 2>/dev/null
    echo "✅ Servidor detenido"
    exit 0
}

# Capturar señales de interrupción
trap cleanup SIGINT SIGTERM

# Mantener el script en primer plano
wait $SERVER_PID