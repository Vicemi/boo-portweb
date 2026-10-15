# Registro de cambios

La descripción de cada release de GitHub es la sección de su versión; la versión de escritorio la muestra al jugador cuando hay una actualización.

## 1.0.2

### Correcciones
- Las puertas ya no se pueden atravesar por abajo o por los bordes del mapa: el original rodea cada mapa con un anillo de celdas sólidas (medido en el juego real) y no estaba reproducido, así que por ejemplo la puerta de la casa (última fila del mapa) dejaba salir del mapa caminando.
- Un error en un componente del juego (por ejemplo un NPC sin diálogo para el estado de la misión) ya no congela todo el juego: el paso sigue y el error se anota una sola vez. Dos errores de ese tipo detectados jugando con estados de misión raros (NPC sin fila en las tablas de misiones, fantasma que golpea al jugador justo al cambiar de mapa) quedan corregidos.
- Guardado más seguro: no se sobrescribe una partida con datos vacíos o dañados, se conserva una copia de la versión anterior (si la partida está dañada se recupera la copia), y el progreso se vuelve a escribir al ocultar o cerrar la página. El formato de las claves (`boo:save:`) y de los archivos no cambia.

### Rendimiento
- Cambiar de mapa es mucho más rápido: las imágenes se decodifican unas 40 veces más rápido (antes la primera imagen de un nivel podía tardar varios segundos en equipos lentos, lo que parecía un cuelgue) y el juego ya no vuelve a leer y analizar unas 30 veces el mismo archivo de mapa (la carga de Lua baja de 150-500 ms a 30-60 ms).
- Menos trabajo por cuadro: limpieza y reducción de color de la pantalla en bloque y sin crear objetos nuevos en cada cuadro.

### Comprobado
- 188 diálogos, todas las puertas (también con todas las misiones cumplidas), partidas aleatorias de varios estados de misión caminando con teclas reales, y 24 mapas sin errores de Lua.

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
