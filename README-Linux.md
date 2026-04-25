# Apuntes Facultad - Linux

## 🚀 Inicio Rápido

### Requisitos
- Python 3.x instalado
- Navegador web moderno

### Instalación y Uso

1. **Descarga el proyecto** a tu PC Linux
2. **Abre una terminal** y navega al directorio del proyecto
3. **Convierte el script en ejecutable:**
   ```bash
   chmod +x start-linux.sh
   ```
4. **Ejecuta el script:**
   ```bash
   ./start-linux.sh
   ```

### Qué hace el script

- ✅ Verifica que Python3 esté instalado
- ✅ Inicia un servidor web local en `http://localhost:8003`
- ✅ Abre automáticamente tu navegador
- ✅ Muestra instrucciones claras
- ✅ Permite detener el servidor con Ctrl+C

### Comandos útiles

```bash
# Iniciar el proyecto
./start-linux.sh

# Detener el servidor (en otra terminal)
pkill -f "python3 -m http.server"

# Verificar si el puerto 8003 está en uso
netstat -tulpn | grep :8003
```

### Instalación de Python3 (si no lo tienes)

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install python3
```

**CentOS/RHEL/Fedora:**
```bash
sudo yum install python3
# o en Fedora:
sudo dnf install python3
```

**Arch Linux:**
```bash
sudo pacman -S python
```

**Manjaro:**
```bash
sudo pacman -S python
```

## 📱 Instalación como App

Una vez que el proyecto esté corrienddo en tu navegador:

1. Abre Chrome/Firefox
2. Ve a `http://localhost:8003`
3. Haz clic en el ícono de "Instalar" o "Añadir a pantalla de inicio"
4. La app se instalará con tu icono personalizado

## 🔧 Solución de Problemas

### Python no encontrado
```bash
# Verifica si Python está instalado
python3 --version

# Si no está instalado, sigue las instrucciones de instalación arriba
```

### Puerto 8003 en uso
```bash
# Encuentra qué proceso usa el puerto
sudo lsof -i :8003

# Mata el proceso si es necesario
sudo kill -9 <PID>
```

### No se abre el navegador automáticamente
- El script intentará abrir tu navegador predeterminado
- Si falla, simplemente abre tu navegador y ve a `http://localhost:8003`

## 📁 Estructura del Proyecto

```
tu-directorio/
├── start-linux.sh          # Este script de inicio
├── index.html              # Página principal
├── styles.css              # Estilos
├── scripts.js              # Lógica
├── manifest.json           # Configuración PWA
├── icon.png               # Tu icono personalizado
└── pdfjs-5.5.207-dist/     # Librería PDF.js
```

## 🎯 Características

- ✅ **Offline total** - Todo funciona sin internet
- ✅ **PWA** - Se puede instalar como app
- ✅ **Multiplataforma** - Funciona en cualquier Linux
- ✅ **Fácil de usar** - Un solo clic para iniciar
- ✅ **Tu icono** - Usa tu imagen personalizada