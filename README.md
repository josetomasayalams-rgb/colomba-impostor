# El impostor de Colomba

Juego para celebrar el baby shower de Colomba. Interfaz para celular, entre 4 y 24 jugadores, un impostor y conceptos relacionados con su llegada.

**Jugar:** https://josetomasayalams-rgb.github.io/colomba-impostor/

La interfaz se publica desde este repositorio en GitHub Pages. Las salas funcionan en Cloudflare Workers y D1, en una cuenta propia. Los invitados entran directamente, sin cuenta de GitHub, Cloudflare ni ChatGPT. Consulta [DEPLOY_GITHUB.md](DEPLOY_GITHUB.md) para las siguientes publicaciones.

1. El anfitrión abre el enlace, pulsa **Crear una sala** y escribe su nombre.
2. Comparte el QR, enlace de invitación o código de seis caracteres.
3. Cada persona entra desde su propio celular. Puede usar Wi-Fi o datos móviles.
4. Con al menos cuatro jugadores, el anfitrión inicia la ronda.
5. Cada persona mira su tarjeta en privado, confirma y da pistas en voz alta. Después conversan y votan desde el celular.

El servidor funciona en la nube: **el Mac puede estar apagado**. El anfitrión debe conservar su navegador y sus datos locales para mantener el control de esa sala. Puede recuperar la sala recargando la página en ese mismo navegador. Los participantes deben estar juntos para escuchar las pistas; la aplicación no transmite audio.

## Reglas y funciones

- Un impostor elegido al azar; el resto recibe el mismo concepto.
- Anfitrión jugador o espectador, hasta 24 jugadores reales.
- Una o dos vueltas de pistas, con tiempo orientativo o sin límite. El anfitrión avanza los turnos.
- Catálogo de 50 conceptos y palabras personalizadas por sala.
- Votos privados, sin voto propio. Se publican los totales al terminar.
- Empate: segunda votación entre las personas empatadas; si persiste, gana el impostor.
- Pausa, reanudación, ingreso tardío y cierre de sala.
- QR real, invitaciones HTTPS y sincronización automática entre 1,5 y 6,5 segundos según el tamaño del grupo.
- Ajustes de texto grande, movimiento reducido y sonido opcional.

## Código y alojamiento

Repositorio: https://github.com/josetomasayalams-rgb/colomba-impostor

La interfaz se aloja en GitHub Pages y el backend en Cloudflare Workers/D1 en una cuenta propia. GitHub conserva el código, ejecuta las pruebas y publica la interfaz; las salas se procesan en el servidor externo. Esta configuración funciona sin Sites. La publicación anterior se conserva como versión independiente.

`server/engine-core.mjs` contiene las reglas compartidas por la versión local y la nube. La versión local usa SQLite; `worker/` adapta las solicitudes a D1. Cada cambio de una sala se confirma con una actualización condicional por versión; ante concurrencia, se vuelve a leer y se validan nuevamente los permisos y las reglas. El estado del juego y los hashes de sesión se guardan juntos para evitar escrituras parciales.

Las tarjetas solo se entregan al navegador de su participante. En el despliegue de GitHub, el navegador usa un token opaco por sala y la API no depende de cookies de terceros. Los conceptos y roles no se guardan en el almacenamiento local. El acceso desde un mismo origen conserva cookies HttpOnly, SameSite=Strict y Secure en HTTPS. Las acciones comprueban origen, intención y token CSRF. Los archivos de servidor, bases de datos, credenciales y registros no se sirven como recursos públicos. Los recursos visuales y tipografías se incluyen en el propio sitio.

Las salas vencen tras 24 horas sin cambios, o 24 horas después de cerrarse. Las filas vencidas se eliminan al crear una sala nueva. La presencia es orientativa: una desconexión puede tardar hasta 40 segundos en reflejarse. La seguridad no impide que una persona muestre voluntariamente su tarjeta ni controla el dispositivo del anfitrión.

## Desarrollo local

Requiere Node.js 22.16 o posterior.

```sh
npm ci
npm start
```

Abre http://localhost:4173. Los datos locales se guardan en `data/`, excluido de Git. Esta modalidad necesita el Mac encendido y la misma red Wi-Fi. Es independiente de las partidas de la nube.

Para probar el backend de la nube en un entorno local:

```sh
npm run build
npx --no-install wrangler d1 migrations apply DB --local
npx --no-install wrangler dev --ip 127.0.0.1 --port 4184 --inspector-port 0 --local
```

En otra terminal:

```sh
npm test
npm run check
npx --no-install playwright install chromium
npm run test:e2e
npm run test:cloud
```

Las pruebas de la nube usan exclusivamente la base local de Wrangler. No apuntes las pruebas de carga a una sala real. El despliegue independiente aplica las migraciones de `drizzle/` a la base Cloudflare elegida antes de publicar. El archivo `.openai/hosting.json` conserva la identidad del alojamiento anterior para recuperación; no se utiliza para el nuevo despliegue. No se deben incluir tokens en el repositorio. `scripts/build.mjs` genera el Worker autocontenido; `scripts/validate-artifact.mjs` comprueba el resultado.

El workflow de GitHub comprueba ambos servidores y la interfaz bajo el subdirectorio del proyecto. Publica Pages cuando está configurada la variable `COLOMBA_API_ORIGIN` con la API ya desplegada; mientras falte esa dirección no publica una versión desconectada. Los cambios del Worker se publican con Wrangler siguiendo `DEPLOY_GITHUB.md`.

## Plan y consumo

El 16 de octubre de 2026 se comprobó en el panel de la cuenta que el plan activo era **Workers Free ($0)**. Esta publicación no contrata ni activa un plan pagado. El plan tiene límites diarios compartidos con las demás aplicaciones de la cuenta; consulta los [límites oficiales de Cloudflare](https://developers.cloudflare.com/workers/platform/limits/).

La frecuencia de consulta se adapta al tamaño de la sala y se detiene en pestañas ocultas. Con entre 4 y 25 participantes conectados, las consultas automáticas de una sala durante seis horas se mantienen por debajo de 90.000 solicitudes en la estimación conservadora comprobada por las pruebas. Las acciones del juego, otras salas y las otras aplicaciones consumen adicionalmente el cupo compartido. El plan gratuito no equivale a uso ilimitado.
