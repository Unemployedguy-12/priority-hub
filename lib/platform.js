'use strict';
// Plataforma "lógica" (puede forzarse con PH_PLATFORM para pruebas). Las operaciones reales del sistema usan process.platform.
const PLATFORM = process.env.PH_PLATFORM || process.platform;
module.exports = { PLATFORM, isWin: PLATFORM === 'win32', isMac: PLATFORM === 'darwin' };
