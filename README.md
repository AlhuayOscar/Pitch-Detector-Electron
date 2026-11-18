# Pitch Detector Electron

Adaptación de [sonovice/pitch-detector](https://github.com/sonovice/pitch-detector) para Electron, basada en el commit `8f1787a131cb09518e59fff80dc8b127b7b16b64`.

## Abrir y usar

1. Descargá `Pitch-Detector-1.1.0-Windows-x64-Portable.exe` y abrilo en Windows de 64 bits. [Descargar la versión portátil](https://github.com/AlhuayOscar/Pitch-Detector-Electron/releases/latest).
2. Pulsá **Iniciar detección** y cantá una nota sostenida cerca del micrófono. La aplicación muestra la nota, la frecuencia, la confianza, la afinación y el historial.
3. Usá **Pausar** para detener el análisis y liberar el micrófono. Pulsá **Reanudar** para seguir.

Las notas entran en el historial desde el teclado de la izquierda y avanzan hacia la derecha. Pulsá **Rotar sistema** para colocar el teclado abajo y ver cómo las notas suben desde las teclas. La tecla de la nota detectada queda resaltada. La barra junto al teclado sigue la altura de la voz y un brillo más suave señala hacia qué tecla se desvía la afinación.

La versión portátil incluye Electron, TensorFlow.js, el modelo SPICE v2 completo y la tipografía. El análisis ocurre en el equipo. La aplicación bloquea las solicitudes externas y no guarda grabaciones. Usa el micrófono predeterminado de Windows.

Si Windows bloqueó el micrófono, abrí **Configuración → Privacidad y seguridad → Micrófono** y verificá el acceso para las aplicaciones de escritorio.

## Compilar desde el código

Con Node.js 22.12 o superior y npm, ejecutá estos comandos desde la carpeta del proyecto:

```powershell
npm ci
npm run typecheck
npm start
```

Para generar el ejecutable portátil de Windows x64:

```powershell
npm run package:win
```

El ejecutable queda en `release/`. La preparación inicial descarga las dependencias y las herramientas de empaquetado. El ejecutable generado funciona sin conexión desde el primer arranque.

`npm run dev` inicia la versión web local de Vite y `npm run build:pages` compila para la ruta de GitHub Pages del proyecto original.

## Créditos y licencias

- La aplicación original es de Simon Waloschek y usa la licencia [MIT](LICENSE).
- El modelo **SPICE v2** para TensorFlow.js es de Google. Los archivos se distribuyen tal como vienen en el repositorio original, bajo [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), para uso no comercial. [Ficha del modelo](https://github.com/tensorflow/tfhub.dev/blob/master/assets/docs/google/models/spice/2.md) · [Exportación a TensorFlow.js](https://www.kaggle.com/models/google/spice/tfJs/default/2).
- Noto Sans se distribuye bajo [SIL Open Font License 1.1](public/fonts/OFL.txt).
