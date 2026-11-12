import { WebSocket, WebSocketServer } from 'ws';
import { once } from 'node:events';

/** Local test proxy. Credentials pass only in memory; evidence contains type/time. */
export async function responseDropProxy(responseType) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sockets = new Set(), dropped = [];
  server.on('connection', (downstream, request) => {
    const upstream = new WebSocket(`ws://127.0.0.1:6767${request.url}`, {
      headers: request.headers.authorization ? { authorization: request.headers.authorization } : {},
    });
    sockets.add(downstream); sockets.add(upstream);
    const queued = [];
    const close = () => { downstream.terminate(); upstream.terminate(); sockets.delete(downstream); sockets.delete(upstream); };
    upstream.on('open', () => { for (const [data, binary] of queued) upstream.send(data, { binary }); queued.length = 0; });
    downstream.on('message', (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); else queued.push([data, binary]);
    });
    upstream.on('message', (data, binary) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { /* Forward non-JSON unchanged. */ }
      if (message?.type === 'session') message = message.message;
      if (message?.type === responseType) {
        dropped.push({ type: message.type, at: new Date().toISOString(), accepted: message.payload?.accepted, hasError: !!message.payload?.error });
        return;
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary });
    });
    upstream.on('error', close); downstream.on('error', close);
    upstream.on('close', close); downstream.on('close', close);
  });
  return { endpoint: `127.0.0.1:${server.address().port}`, dropped,
    close: async () => { for (const socket of sockets) socket.terminate(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
