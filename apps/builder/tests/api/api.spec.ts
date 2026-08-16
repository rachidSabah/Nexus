import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';

describe('Builder API Layer Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const serverResult = await createServer();
    app = serverResult.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health should return 200 and healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('healthy');
    expect(json.service).toBe('agent-nexus-builder');
  });

  it('GET /metrics should return runtime system metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.counts).toBeDefined();
    expect(json.system).toBeDefined();
  });

  it('GET /api/v1/templates should list built-in templates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/templates',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data.some((t: { id: string }) => t.id === 'node-ts-app')).toBe(true);
  });

  it('POST /api/v1/projects and GET /api/v1/projects should create and list projects', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        name: 'Nexus API Project',
        framework: 'typescript',
        description: 'End-to-end builder test project',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    expect(created.success).toBe(true);
    const projectId = created.data.id;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = JSON.parse(getRes.body);
    expect(fetched.data.name).toBe('Nexus API Project');

    // Trigger a build for this project
    const buildRes = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      payload: {
        projectId,
        customSteps: [
          { id: 'echo-test', name: 'Echo Test', command: 'echo "Pipeline Step Executed"' },
        ],
      },
    });

    expect(buildRes.statusCode).toBe(202);
    const buildJson = JSON.parse(buildRes.body);
    expect(buildJson.success).toBe(true);
    const buildId = buildJson.data.id;

    // Check build status
    const getBuildRes = await app.inject({
      method: 'GET',
      url: `/api/v1/builds/${buildId}`,
    });
    expect(getBuildRes.statusCode).toBe(200);
    const buildDetails = JSON.parse(getBuildRes.body);
    expect(buildDetails.data.id).toBe(buildId);

    // Check build logs
    const logsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/builds/${buildId}/logs`,
    });
    expect(logsRes.statusCode).toBe(200);
  });
});
