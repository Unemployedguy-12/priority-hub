# Priority Hub 1.0

Pega cualquier enlace → detecta el descargable → eliges la carpeta → se mantiene actualizado. Funciona en **Linux** y **Windows**.

## Qué hace
- **Detecta descargables** en GitHub, GitLab, Codeberg/Gitea/Forgejo, Bitbucket, SourceForge, enlaces directos y cualquier página web.
- **Tipos Linux:** AppImage, `.sh`/`.py`, `.run`, paquetes Arch, Flatpak, binarios, comprimidos, `.jar`, `.deb`, `.rpm`, `.snap`.
- **Tipos Windows:** `.exe`, `.msi`, `.bat`/`.cmd`/`.ps1`/`.py`, comprimidos `.zip`, `.jar`. Solo te muestra lo compatible con tu sistema y arquitectura (puedes ver "Todos").
- **Tú eliges la carpeta** de cada instalación y puedes crear el acceso en el menú de apps.
- **Se mantiene al día:** revisa lo instalado y *vigila* las páginas que marques, avisándote cuando sale algo nuevo.

## Usar
**Linux**

    chmod +x Priority-Hub-1.0.0-x86_64.AppImage && ./Priority-Hub-1.0.0-x86_64.AppImage

**Windows:** ejecuta `Priority-Hub-1.0.0-Setup.exe` (instalador) o `Priority-Hub-1.0.0-portable.exe` (sin instalar). Los `.exe` no están firmados: SmartScreen puede avisar, elige *Más información → Ejecutar de todas formas*.

## Compilar desde el código
    npm install         # copia fuentes e iconos desde npm y genera el icono (scripts/setup-assets.js)
    npm run dist        # Linux: dist/Priority-Hub-*.AppImage
    npm run dist:win    # Windows: instalador y portable (mejor compilarlo en Windows)
    npm start           # modo desarrollo
    npm test            # pruebas de lógica

## Notas
- Iconos en el menú para AppImages: instala `p7zip` (`sudo pacman -S p7zip`). Sin él se usa el icono del repo o uno genérico (nunca se ejecuta el AppImage para sacarlo).
- Scripts (.sh/.py/.run/.bat/.ps1), paquetes Arch y Flatpak se ejecutan SIEMPRE en una terminal/consola, tras mostrarte su contenido/comando.
- En Windows los accesos se crean en el menú Inicio; los `.exe`/`.msi` se abren con el sistema (UAC incluido).
- Token de GitHub opcional en Ajustes (sube el límite de 60 a 5000 consultas/hora); recomendable si vigilas varias páginas.
- Datos: `~/.config/priority-hub/priority-hub.json` (Linux) · `%APPDATA%\priority-hub\priority-hub.json` (Windows)

## Releases
Al subir un tag `v*` (ej. `git tag v1.0.0 && git push origin v1.0.0`) GitHub Actions compila el AppImage (Linux) y el instalador + portable (Windows) y los adjunta al release.
Priority Hub puede instalarse y actualizarse a sí mismo pegando la URL de este repo.
