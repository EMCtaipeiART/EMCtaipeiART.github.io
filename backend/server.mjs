import { createApp } from './app.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8787;
const { server, database } = await createApp();

server.listen(port, host, () => {
  console.log(`Machi JSON backend: http://${host}:${port}`);
  console.log(`Database: ${database.filePath}`);
});

function shutdown(signal) {
  console.log(`\n${signal}: closing server`);
  server.close(error => process.exit(error ? 1 : 0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
