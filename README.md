# Pitch Detector Electron

Adaptación de [sonovice/pitch-detector](https://github.com/sonovice/pitch-detector) para Electron, basada en el commit `8f1787a131cb09518e59fff80dc8b127b7b16b64`.

## Abrir y usar

1. Descargá `Pitch-Detector-1.2.0-Windows-x64-Portable.exe` y abrilo en Windows de 64 bits. [Descargar la versión portátil](https://github.com/AlhuayOscar/Pitch-Detector-Electron/releases/latest).
2. Elegí **Pitch** en el inicio, pulsá **Iniciar detección** y cantá una nota sostenida cerca del micrófono. La aplicación muestra la nota, la frecuencia, la confianza, la afinación y el historial.
3. Usá **Pausar** para detener el análisis y liberar el micrófono. Pulsá **Reanudar** para seguir.

Las notas entran en el historial desde el teclado de la izquierda y avanzan hacia la derecha. Pulsá **Rotar sistema** para colocar el teclado abajo y ver cómo las notas suben desde las teclas. La tecla de la nota detectada queda resaltada. La barra junto al teclado sigue la altura de la voz y un brillo más suave señala hacia qué tecla se desvía la afinación.

La versión portátil incluye Electron, TensorFlow.js, el modelo SPICE v2 completo y la tipografía. El análisis ocurre en el equipo. Pitch bloquea las solicitudes externas y no guarda grabaciones. Usa el micrófono predeterminado de Windows.

Si Windows bloqueó el micrófono, abrí **Configuración → Privacidad y seguridad → Micrófono** y verificá el acceso para las aplicaciones de escritorio.

## VocalRemover

El mosaico **VocalRemover** abre la ventana oficial de Ultimate Vocal Remover 5.6. La separación se ejecuta en el equipo mediante los modelos descargados.

- Si ya instalaste Ultimate Vocal Remover en Windows, abrí el mosaico y pulsá **Abrir Ultimate Vocal Remover**. **Buscar UVR instalado** permite seleccionar manualmente su ejecutable. [Descarga oficial de UVR 5.6](https://github.com/Anjok07/ultimatevocalremovergui/releases/tag/v5.6).
- Desde una copia de este repositorio podés preparar el entorno local con Python 3.10 y FFmpeg disponibles. Ejecutá `.\scripts\prepare-uvr.ps1` en PowerShell. El entorno queda en `.uvr/`, fuera de Git, y se detecta desde el programa portátil en `release/`. La preparación inicial descarga el código, las dependencias y el modelo.
- En UVR, elegí **MDX-Net**, seleccioná **UVR-MDX-NET Inst Main**, indicá el archivo de entrada y la carpeta de salida, y pulsá **Start Processing**. La instalación oficial puede requerir agregar este modelo una vez desde el centro de descargas de UVR.

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

El ejecutable queda en `release/`. La preparación inicial descarga las dependencias y las herramientas de empaquetado. Pitch funciona sin conexión desde el primer arranque. VocalRemover usa el entorno local preparado o una instalación existente de UVR.

`npm run dev` inicia la versión web local de Vite y `npm run build:pages` compila para la ruta de GitHub Pages del proyecto original.

## Créditos y licencias

- La aplicación original es de Simon Waloschek y usa la licencia [MIT](LICENSE).
- El modelo **SPICE v2** para TensorFlow.js es de Google. Los archivos se distribuyen tal como vienen en el repositorio original, bajo [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), para uso no comercial. [Ficha del modelo](https://github.com/tensorflow/tfhub.dev/blob/master/assets/docs/google/models/spice/2.md) · [Exportación a TensorFlow.js](https://www.kaggle.com/models/google/spice/tfJs/default/2).
- Noto Sans se distribuye bajo [SIL Open Font License 1.1](public/fonts/OFL.txt).
- Ultimate Vocal Remover, el modelo UVR-MDX-NET y la interfaz oficial son obra de Anjok07, Aufr33 y sus colaboradores. [Código y créditos de UVR 5.6](https://github.com/Anjok07/ultimatevocalremovergui/blob/v5.6/README.md#license).
