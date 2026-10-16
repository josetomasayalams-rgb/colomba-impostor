# Validación de la versión online

Fecha: 16 de octubre de 2026. Código independiente de la versión local original.

## Antes de publicar

- `npm run check`: sintaxis correcta.
- `npm test`: 28 pruebas aprobadas; reglas, privacidad, sesiones, permisos, votos, concurrencia y reinicio SQLite.
- `npm run test:e2e`: 5 recorridos aprobados contra Node, incluido reinicio real del servidor.
- `npm run test:cloud`: 6 recorridos aprobados contra el Worker y una base D1 local; sin casos omitidos. Incluye una partida completa, 24 participantes entrando, mirando tarjetas y votando concurrentemente, rechazo de inicio duplicado, límites de jugadores, privacidad, CSRF, origen, recursos de servidor, reingreso, conexión y vistas móviles.
- `npm run build` y `node scripts/validate-artifact.mjs`: Worker ESM autocontenido válido.
- `npm audit --omit=dev`: cero vulnerabilidades conocidas en dependencias de ejecución. El generador de migraciones conserva cuatro avisos moderados en dependencias de desarrollo; no forma parte del Worker publicado ni se expone como servidor.

La nube utiliza el mismo motor de reglas que Node, con persistencia D1 y control de concurrencia mediante versión de cada fila. Cada solicitud lee la base; no depende de memoria de un proceso, archivos del Mac ni sesiones guardadas en JavaScript del servidor. Las acciones simultáneas que pierden una comparación vuelven a leer y validar antes de intentar guardar.

## Límites de verificación

Las pruebas móviles utilizan Chromium con pantallas y sesiones independientes simuladas. No sustituyen una comprobación en iPhone/Safari y Android físicos. Las pistas y la conversación se realizan en voz alta, fuera de la aplicación. La sincronización online consulta cambios cada 1,5 segundos aproximadamente y depende de la conexión del teléfono y del servicio de alojamiento.

GitHub Actions comprueba cambios del repositorio. Publicar en GitHub no despliega automáticamente Sites: cada publicación debe guardar y desplegar la versión correspondiente mediante la integración autenticada, manteniendo el mismo proyecto y la misma base D1.

## Preparación de GitHub Pages (versión 1.2)

- 33 pruebas de backend, reglas y controles de origen aprobadas.
- 2 recorridos adicionales aprobados con la interfaz en `/colomba-impostor/` y la API en un origen distinto: partida completa, QR con invitación a Pages, recarga conservando identidad, tarjetas y votos privados, rechazo de otros orígenes y permisos del anfitrión.
- Los recorridos comprueban que no se envían cookies a la API y que no quedan roles ni conceptos en el almacenamiento local.
- El backend independiente y el enlace GitHub Pages todavía requieren conectar la cuenta Cloudflare. La versión anterior publicada en Sites corresponde al commit anterior; no se ha sustituido ni eliminado.
