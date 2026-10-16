# Publicación desde GitHub Pages

El enlace de la aplicación será:

https://josetomasayalams-rgb.github.io/colomba-impostor/

La interfaz se publica desde el repositorio GitHub. Las salas necesitan un backend externo porque GitHub Pages solo aloja archivos estáticos. La implementación está preparada para Cloudflare Workers y D1 en una cuenta propia, sin depender de Sites y sin exigir una cuenta a los invitados.

## Validación previa

```sh
npm ci
npm run check
npm test
npm run build
node scripts/validate-artifact.mjs
npx --no-install wrangler d1 migrations apply DB --local
COLOMBA_API_ORIGIN=http://127.0.0.1:4184 npm run build:pages
npm run test:pages
```

Estas pruebas sirven la interfaz bajo `/colomba-impostor/` en un origen distinto de la API, como sucederá en producción. Comprueban las invitaciones, las tarjetas privadas, la recuperación al recargar, los permisos y los votos sin cookies de terceros.

## Conectar la cuenta de alojamiento

La conexión Cloudflare encontrada en este Mac estaba vencida. Es necesario volver a iniciar sesión antes de crear la base y publicar el servidor:

```sh
npx --no-install wrangler login
npx --no-install wrangler whoami
```

No guardar ni pegar tokens en GitHub ni en el código. Los comandos siguientes deben ejecutarse solo después de verificar la cuenta elegida y confirmar que no existe ya un recurso de esta misma aplicación que se deba reutilizar.

## Publicar la API

```sh
npx --no-install wrangler d1 create colomba-impostor
node scripts/configure-cloud.mjs UUID_DEVUELTO_POR_CLOUDFLARE
npm run build
npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.production.json
npx --no-install wrangler deploy --config wrangler.production.json
```

Conservar la URL HTTPS `.workers.dev` que devuelva Cloudflare. `wrangler.production.json` contiene identificadores de recursos y está excluido de Git; no contiene credenciales. Reutilizar esa misma base y ese mismo Worker en las siguientes actualizaciones.

## Conectar y publicar GitHub Pages

Guardar la URL de la API como variable del repositorio (es una dirección pública, no una clave):

```sh
gh variable set COLOMBA_API_ORIGIN --repo josetomasayalams-rgb/colomba-impostor --body https://URL_DEVUELTA.workers.dev
```

Activar Pages con fuente **GitHub Actions** y ejecutar el workflow `Verify game`. El job de publicación solo se activa cuando está configurada la URL de la API y las pruebas han pasado. No publica una versión desconectada ni redirige a Sites.

Después de publicar, comprobar la URL `github.io` en una sesión sin acceso a ChatGPT y completar una partida con varios navegadores. No basta con que cargue la portada.

## Sesiones y privacidad

GitHub Pages y la API usan orígenes distintos. El navegador recibe un token opaco por sala y lo conserva localmente para recuperar su identidad. No guarda conceptos ni roles en ese almacenamiento. La API valida el token, el origen, el CSRF, los permisos y la versión de la partida; solo admite peticiones del origen configurado de GitHub Pages. Las invitaciones y el QR apuntan al enlace de GitHub, sin tokens en la URL.

La publicación anterior en Sites se conserva sin cambios mientras se prepara el nuevo alojamiento. Las salas de esa publicación no se trasladan automáticamente a la nueva base. La URL nueva estará operativa una vez conectada la cuenta, publicada la API y completado el despliegue de Pages.
