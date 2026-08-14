import { NvidiaNimAdapter } from './src/index.js';
const adapter = new NvidiaNimAdapter();
const endpoint = {
  id: 'auto-nvidia-nim', providerId: 'nvidia-nim', displayName: 'nvidia-nim',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  capabilities: {}, pricing: {}, priority: 1, weight: 1, health: 'healthy',
  tags: ['auto', 'key-registered'], timeoutMs: 30000, maxRetries: 2, concurrencyLimit: 10,
  createdAt: new Date(), updatedAt: new Date(),
};
try {
  const models = await adapter.discoverModels(endpoint, new AbortController().signal);
  console.log('discovered:', models.length);
  console.log('sample:', JSON.stringify(models.slice(0, 1), null, 1));
} catch (e) {
  console.log('THREW:', e.message);
  console.log(JSON.stringify(e, null, 1));
}