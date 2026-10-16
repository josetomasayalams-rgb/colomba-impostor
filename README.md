# El impostor de Colomba

Juego para celebrar el baby shower de Colomba. Interfaz para celular, entre 4 y 24 jugadores, un impostor y conceptos relacionados con su llegada.

**Jugar:** https://colomba-impostor.jayala2407.chatgpt.site

1. El anfitrión abre el enlace, pulsa **Crear una sala** y escribe su nombre.
2. Comparte el QR, enlace de invitación o código de seis caracteres.
3. Cada persona entra desde su propio celular. Puede usar Wi-Fi o datos móviles.
4. Con al menos cuatro jugadores, el anfitrión inicia la ronda.
5. Cada persona mira su tarjeta en privado, confirma y da pistas en voz alta. Después conversan y votan desde el celular.

El servidor funciona en la nube: **el Mac puede estar apagado**. El anfitrión debe conservar su navegador y sus cookies para mantener el control de esa sala. Puede recuperar la sala recargando la página en ese mismo navegador. Los participantes deben estar juntos para escuchar las pistas; la aplicación no transmite audio.

## Reglas y funciones

- Un impostor elegido al azar; el resto recibe el mismo concepto.
- Anfitrión jugador o espectador, hasta 24 jugadores reales.
- Una o dos vueltas de pistas, con tiempo orientativo o sin límite. El anfitrión avanza los turnos.
- Catálogo de 50 conceptos y palabras personalizadas por sala.
- Votos privados, sin voto propio. Se publican los totales al terminar.
- Empate: segunda votación entre las personas empatadas; si persiste, gana el impostor.
- Pausa, reanudación, ingreso tardío y cierre de sala.
- QR real, invitaciones HTTPS y sincronización automática cada 1,5 segundos aproximadamente.
- Ajustes de texto grande, movimiento reducido y sonido opcional.

## Código y alojamiento

Repositorio: https://github.com/josetomasayalams-rgb/colomba-impostor

El sitio público se aloja en Sites sobre Cloudflare Workers. Las salas, roles, votos y sesiones se guardan en D1. GitHub conserva el código y ejecuta las pruebas; el sitio no utiliza GitHub Pages, que sirve contenido estático y no ejecuta este backend.

`server/engine-core.mjs` contiene las reglas compartidas por la versión local y la nube. La versión local usa SQLite; `worker/` adapta las solicitudes a D1. Cada cambio de una sala se confirma con una actualización condicional por versión; ante concurrencia, se vuelve a leer y se validan nuevamente los permisos y las reglas. El estado del juego y los hashes de sesión se guardan juntos para evitar escrituras parciales.

Las tarjetas solo se entregan al navegador de su participante. Las cookies son HttpOnly, SameSite=Strict y Secure en HTTPS; las acciones comprueban origen, intención y token CSRF. Los archivos de servidor, bases de datos, credenciales y registros no se sirven como recursos públicos. Los recursos visuales y tipografías se incluyen en el propio sitio.

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

Las pruebas de la nube usan exclusivamente la base local de Wrangler. No apuntes las pruebas de carga a una sala real. El proceso de publicación de Sites aplica las migraciones incluidas en `drizzle/` antes de publicar el Worker. Se debe conservar el `project_id` de `.openai/hosting.json`; no se deben incluir tokens en el repositorio. `scripts/build.mjs` genera el Worker autocontenido; `scripts/validate-artifact.mjs` comprueba el resultado.

El despliegue de Sites se realiza mediante su integración autenticada. Un push a GitHub ejecuta CI; por sí solo no publica una nueva versión del sitio.
