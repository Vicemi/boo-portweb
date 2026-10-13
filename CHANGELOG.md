# Registro de cambios

La descripción de cada release de GitHub es la sección de su versión; la versión de escritorio la muestra al jugador cuando hay una actualización.

## 1.0.1

### Correcciones
- El juego ya no se queda "cargando" al cambiar de nivel: una imagen que falta (por ejemplo la del bebé en sus diálogos) ya no detiene el juego, y las líneas de diálogo vacías esperan la tecla en vez de colgarse.
- La puerta del sótano 3 al jefe final funcionaba mal (el cuarto del jefe no tiene puertas): ahora entras por su punto de inicio.
- Comprobado: los 188 diálogos terminan y todas las puertas de los 24 mapas cambian de nivel sin errores (también con todas las misiones cumplidas).

## 1.0.0

**Primera versión: Boo en el navegador y en Windows, recreado por Vicemi Dev (vicemi.dev).**

### Novedades
- **Web**: el juego original completo (el código Lua del juego se ejecuta tal cual en una máquina virtual propia) con mouse, teclado y gamepad táctil para celulares.
- **Escritorio (Windows, sin internet)**: ventana propia con pantalla completa y resoluciones, partidas guardadas en la carpeta de instalación con guardado automático y copias de seguridad, instalador con desinstalador y créditos.
- **Actualizaciones**: el juego busca solo las releases nuevas del repositorio y muestra su registro de cambios antes de descargarlas.
- Todos los recursos originales (imágenes, sonidos, mapas, fuentes y datos).
