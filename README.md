# Priority Hub v2

Pega cualquier enlace → detecta el descargable → eliges la carpeta → se mantiene actualizado.

## Usar
    chmod +x Priority-Hub-2.0.0-x86_64.AppImage && ./Priority-Hub-2.0.0-x86_64.AppImage

## Compilar desde el código
    npm install         # copia fuentes e iconos desde npm y genera el icono (scripts/setup-assets.js)
    npm run dist        # genera dist/Priority-Hub-*.AppImage
    npm start           # modo desarrollo
    npm test            # pruebas de lógica

## Notas
- Iconos en el menú para AppImages: instala `p7zip` (`sudo pacman -S p7zip`). Sin él se usa un icono genérico (nunca se ejecuta el AppImage para sacarlo).
- Scripts (.sh/.py/.run), paquetes Arch y Flatpak se ejecutan SIEMPRE en una terminal, tras mostrarte su contenido/comando.
- Token de GitHub opcional en Ajustes (sube el límite de 60 a 5000 consultas/hora).
- Datos: ~/.config/priority-hub/priority-hub.json

## Releases
Al subir un tag `v*` (ej. `git tag v2.0.0 && git push origin v2.0.0`) GitHub Actions compila el AppImage y lo adjunta al release.
Priority Hub puede instalarse y actualizarse a sí mismo pegando la URL de este repo.
