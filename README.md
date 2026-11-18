# Pitch Detector Electron

Adaptación de [sonovice/pitch-detector](https://github.com/sonovice/pitch-detector) para Electron, basada en el commit `8f1787a131cb09518e59fff80dc8b127b7b16b64`.

## Objetivo del proyecto

Convertir Pitch Detector Electron en un coordinador de voz para practicar canto. La meta es cargar una referencia cantada desde un audio o video, ver sus notas como una guía semitransparente detrás de la voz en vivo y ajustar la tonalidad de la canción al rango cómodo de quien canta.

La primera etapa del coordinador se desarrolla en la rama `Automatized`. Su alcance es comparar las notas de una melodía de referencia con la voz y permitir bajar la canción por semitonos.

## Abrir y usar

1. Descargá `Pitch-Detector-1.3.0-Windows-x64-Portable.exe` y abrilo en Windows de 64 bits. [Descargar la versión portátil](https://github.com/AlhuayOscar/Pitch-Detector-Electron/releases/latest).
2. Elegí **Pitch** en el inicio, pulsá **Iniciar detección** y cantá una nota sostenida cerca del micrófono. La aplicación muestra la nota, la frecuencia, la confianza, la afinación y el historial.
3. Usá **Pausar** para detener el análisis y liberar el micrófono. Pulsá **Reanudar** para seguir.

Las notas entran en el historial desde el teclado de la izquierda y avanzan hacia la derecha. Pulsá **Rotar sistema** para colocar el teclado abajo y ver cómo las notas suben desde las teclas. La tecla de la nota detectada queda resaltada. La barra junto al teclado sigue la altura de la voz y un brillo más suave señala hacia qué tecla se desvía la afinación.

La versión portátil incluye Electron, TensorFlow.js, el modelo SPICE v2 completo y la tipografía. El análisis ocurre en el equipo. Pitch bloquea las solicitudes externas y no guarda grabaciones. Usa el micrófono predeterminado de Windows.

Si Windows bloqueó el micrófono, abrí **Configuración → Privacidad y seguridad → Micrófono** y verificá el acceso para las aplicaciones de escritorio.

## Instrumentos y sesiones

- Las teclas del piano se pueden tocar con el mouse, con varios dedos o con el teclado. Enfocá una tecla con Tab, elegí la nota con las flechas y tocala con Espacio o Enter. El selector **Instrumento** cambia entre piano, órgano, cuerdas y sintetizador. Los sonidos se sintetizan en el equipo.
- Al pulsar **Iniciar detección**, la app de escritorio graba la mezcla del micrófono y del instrumento. El historial muestra la voz en verde y el instrumento en violeta con la misma escala de tiempo. **Pausar detección** pausa la grabación y libera el micrófono.
- Debajo de **Afinación** aparecen el rango de la voz y una tonalidad mayor o menor estimada con las notas de voz de la sesión. La tonalidad queda por determinar cuando las notas son escasas o ambiguas. [Algoritmo de estimación tonal](https://academic.oup.com/book/40395/chapter/347203084).
- La app guarda automáticamente cada minuto, al pausar, al volver al inicio y al cerrar. **Guardar ahora** crea un punto de guardado manual. En **Sesiones** podés abrir el audio con el reproductor del sistema o abrir la carpeta local. Cada sesión contiene la mezcla WebM y archivos JSON con eventos y resúmenes.
- Si ejecutás el portátil desde `release/` en tu copia del proyecto, las grabaciones quedan en `Sesiones/` junto a `release/`, fuera de Git. Si la ubicación no admite escritura, se guardan en Documentos, bajo `Pitch Detector Electron/Sesiones`.

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
