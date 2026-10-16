import { writeFile } from 'node:fs/promises';
const databaseId = process.argv[2];
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId || '')) throw new Error('Provide the database UUID returned by wrangler d1 create.');
const config = {
  name: 'colomba-impostor-api',
  main: 'dist/server/index.js',
  compatibility_date: '2026-10-01',
  workers_dev: true,
  vars: { FRONTEND_URL: 'https://josetomasayalams-rgb.github.io/colomba-impostor/' },
  d1_databases: [{ binding: 'DB', database_name: 'colomba-impostor', database_id: databaseId, migrations_dir: 'drizzle' }],
};
await writeFile('wrangler.production.json', JSON.stringify(config, null, 2) + '\n');
console.log('Production configuration written without credentials.');
