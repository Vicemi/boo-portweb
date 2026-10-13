# Boo — versión web y de escritorio

Port (Astro + React + Canvas, y una versión de escritorio en Rust) de *Boo*, el juego de fantasmas de **Trojan Chicken** para las laptops XO (Plan Ceibal / OLPC, actividad Sugar). Un juego que se dio por perdido (*lost media*): aquí se conserva y se puede volver a jugar en el navegador o instalado en Windows. Incluye los recursos originales (imágenes, sonidos, fuentes, mapas, datos).

**Jugar:** https://boo.vicemi.dev

## Cómo funciona (y honestidad)
- El original es un motor nativo en C++ (SDL 1.2 + luabind) que ejecuta **el código del juego en Lua 5.1 compilado (bytecode)**. Este port no transpila el juego: trae una **máquina virtual de Lua 5.1 escrita en TypeScript** (probada contra Lua real) que ejecuta el bytecode **original, sin tocarlo**, y reimplementa en TypeScript el motor nativo que el Lua usa (entidades y componentes, escenas, animaciones, colisiones, mapas TMX, texto, diálogos, sonido, entrada).
- El motor se hizo mirando el comportamiento del original: se ejecutó el juego real como **oráculo** (colisiones y pendientes, empuje de cajas, triggers, animaciones, tiempos de los diálogos, entrada, texto) y se comprobó que el port da los mismos resultados (`tests/`). El resultado en pantalla coincide con el original en 16 bits de color.
- El código Lua descompilado (`research/`) no se publica. Los recursos originales sí se incluyen (son los del juego).
- Hecho con ayuda de IA (Claude, Anthropic). Lo que no se pudo verificar al 100 % está anotado en `MODLOG.md`.

## Controles
Flechas: moverse · **S**: hablar / avanzar diálogos / interactuar · **A**: flash · **Espacio**, **Enter** o **X**: elegir en los menús · **Esc** o **Z**: volver. En el celular aparece un gamepad táctil.

## Progreso
Se guarda en el navegador (localStorage). Los botones 💾 / 📂 descargan y cargan un archivo `.json` con tus partidas.

## Uso
```bash
npm install
npm run dev        # desarrollo
npm run build      # dist/
npm run assets     # vuelve a empaquetar los recursos desde Boo.activity -> public/game
```
`npm run assets` empaqueta `Boo.activity` en `public/game`: `core.pak` (bytecode Lua, datos, fuentes y las imágenes de los primeros niveles), `late.pak` (jefes, fantasmas y personajes; se descarga en segundo plano y una imagen que todavía no llegó simplemente no se dibuja) y `sounds/` (se piden al reproducirse).

## Versión de escritorio (offline, en Rust)
`desktop/` es un workspace de Rust con dos programas: **`boo.exe`** (ventana propia con WebView2 / `wry` + `tao`, menú de pantalla completa y resoluciones, partidas en `saves/` dentro de la instalación con guardado automático y copias, buscador de actualizaciones) y **`Boo-Instalador.exe`** (instalador por usuario con interfaz propia, accesos directos y desinstalador, con los créditos de Vicemi Dev). Para compilarlo: `python tools/build_desktop.py` (Rust + SDK de Windows) → `desktop/release/Boo-Instalador.exe`. Para publicar: subir la versión en `desktop/Cargo.toml`, escribir su sección en `CHANGELOG.md` y `python tools/publish_release.py <versión>`.

## Créditos
Juego original: **Trojan Chicken** (Plan Ceibal / OLPC). Port web y de escritorio, motor y herramientas: **[Vicemi Dev](https://vicemi.dev)**.
