import { describeDocumentCacheContract } from './__fixtures__/document-cache-contract.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

describeDocumentCacheContract('MemoryDocumentCache', () => {
  const storage = new MemoryCacheStorage();
  return Promise.resolve([new MemoryDocumentCache(storage), new MemoryDocumentCache(storage)]);
});
