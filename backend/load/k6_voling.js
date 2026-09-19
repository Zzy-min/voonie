import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

export const options = {
  scenarios: {
    staged_api: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: 10 },
        { duration: '5m', target: 50 },
        { duration: '5m', target: 100 },
        { duration: '10m', target: 300 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8011';
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function setup() {
  const users = [];
  for (let index = 0; index < 50; index += 1) {
    const response = http.post(`${baseUrl}/api/v1/auth/device`, JSON.stringify({
      device_id: `k6-${runId}-${index}`,
      app_version: 'load-test',
    }), { headers: { 'Content-Type': 'application/json' } });
    check(response, { 'setup login 200': (r) => r.status === 200 });
    users.push(response.json('access_token'));
  }
  return { users };
}

export default function (data) {
  const token = data.users[exec.vu.idInTest % data.users.length];
  const headers = { Authorization: `Bearer ${token}` };
  const selector = exec.scenario.iterationInTest % 20;
  let response;
  if (selector < 9) {
    response = http.get(`${baseUrl}/api/v1/entries?limit=20`, { headers });
  } else if (selector < 14) {
    response = http.get(`${baseUrl}/api/v1/diaries`, { headers });
  } else if (selector < 19) {
    response = http.get(`${baseUrl}/api/v1/auth/me`, { headers });
  } else {
    const localId = `k6-${runId}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
    response = http.post(`${baseUrl}/api/v1/entries/text`, JSON.stringify({
      local_id: localId,
      text: '并发测试日记，包含中文、emoji 🌇 与换行。\n第二段。',
      entry_date: '2026-09-19T11:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }), { headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': localId } });
  }
  check(response, { 'response is 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
