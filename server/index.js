import { createServer } from './ws-server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = createServer({ port: PORT });

server.httpServer.on('listening', () => {
  const addr = server.httpServer.address();
  console.log(`TmuxWeb server listening on http://localhost:${addr.port}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

function shutdown() {
  console.log('Shutting down...');
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
