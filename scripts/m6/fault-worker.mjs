import { JsonRequestStore } from '../../server/adapters/storage/json-request-store.ts';

const [directory, token, boundary] = process.argv.slice(2);
if (!directory || !token || !['before-rename', 'after-rename'].includes(boundary)) throw new Error('Usage: fault-worker.mjs <directory> <token> before-rename|after-rename');
const pauseAtBoundary = async () => {
  process.send?.({ boundary });
  await new Promise(() => {});
};
const store = new JsonRequestStore(directory, boundary === 'before-rename' ? { beforeRename: pauseAtBoundary } : { afterRename: pauseAtBoundary });
await store.open();
try {
  const record = await store.get(token);
  if (!record) throw new Error('FIXTURE_NOT_FOUND');
  record.feature.title = `M6 ${boundary}`;
  await store.save(record);
} finally {
  await store.close();
}
