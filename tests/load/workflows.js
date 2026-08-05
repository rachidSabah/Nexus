// k6 load test: 100 concurrent workflows
// Run: k6 run tests/load/workflows.js
//
// Requires the gateway running at http://localhost:8787

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(50)<500', 'p(99)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8787';

export default function () {
  // Create a workflow
  const createRes = http.post(
    `${BASE}/v1/workflows`,
    JSON.stringify({
      id: `load-test-${Date.now()}`,
      name: 'Load Test Workflow',
      description: 'Load test',
      steps: [
        { name: 's1', agent: 'claude-code', task: 'do ${inputs.x}' },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(createRes, {
    'workflow created': (r) => r.status === 201,
  });

  if (createRes.status !== 201) return;

  const wfId = createRes.json('id');

  // Execute it
  const execRes = http.post(
    `${BASE}/v1/workflows/${wfId}/execute`,
    JSON.stringify({ inputs: { x: 'hello' } }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(execRes, {
    'execution started': (r) => r.status === 202,
  });

  sleep(0.5);
}
