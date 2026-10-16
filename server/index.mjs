import { fileURLToPath } from 'node:url';
import { createApp } from './http.mjs';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';

const dbPath = process.env.COLOMBA_DB ?? fileURLToPath(new URL('../data/colomba.sqlite', import.meta.url));
const pidFile = dbPath === ':memory:' ? null : `${dbPath}.pid`;
const app = createApp({ dbPath, port: Number(process.env.PORT ?? 4173), host: process.env.HOST ?? '0.0.0.0' });
try {
  const urls = await app.listen();
  if (pidFile) writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  console.log(`\n  Colomba · El impostor\n  En este Mac: ${urls.local}\n${urls.network.map(u => `  En la misma red Wi-Fi: ${u}`).join('\n')}\n\n  Mantén esta ventana abierta durante el juego.\n`);
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? 'El puerto ya está ocupado. Cierra la otra instancia de Colomba o elige otro PORT.' : error.message);
  await app.close(); process.exitCode = 1;
}
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
process.on('exit', () => { if (pidFile) { try { if (readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile); } catch { /* La siguiente ejecución puede crear su propio archivo. */ } } });
