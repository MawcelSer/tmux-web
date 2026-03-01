import { createServer } from './ws-server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = createServer({ port: PORT });

server.httpServer.on('listening', () => {
  const addr = server.httpServer.address();
  console.log(`TmuxWeb server listening on http://localhost:${addr.port}`);
});
