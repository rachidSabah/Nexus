// Probe 2: reproduce the real test boot through GatewayRuntime.create().
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, readFileSync, existsSync } from 'fs';

process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-test-vault.json');
process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
process.env['ANX_CONFIG'] = '';
process.env['PORT'] = '18787';
rmSync(join(tmpdir(), 'anx-test-vault.json'), { force: true });
rmSync(join(tmpdir(), 'anx-test-vault.key'), { force: true });

// Env leak check: which auto-endpoint env vars exist in THIS process?
const autoEnv = ['OPENAI_API_KEY','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY','OPENROUTER_API_KEY','GROQ_API_KEY','GOOGLE_API_KEY','MISTRAL_API_KEY','XAI_API_KEY','TOGETHER_API_KEY','FIREWORKS_API_KEY','CEREBRAS_API_KEY','NVIDIA_API_KEY','OPENCODE_ZEN_API_KEY','OPENCODE_GO_API_KEY'];
console.log('0) auto-endpoint env vars present:', autoEnv.filter((k) => process.env[k]).join(', ') || 'NONE');

const { GatewayRuntime } = await import('./src/runtime.js');
try {
  const rt = await GatewayRuntime.create(undefined);
  console.log('CREATE OK — vault file exists:', existsSync(join(tmpdir(), 'anx-test-vault.json')));
  if (existsSync(join(tmpdir(), 'anx-test-vault.json'))) {
    console.log('vault file content:', readFileSync(join(tmpdir(), 'anx-test-vault.json'), 'utf8'));
  }
  await rt.stop();
} catch (err) {
  console.log('CREATE FAILED:', (err as Error).message);
  console.log((err as Error).stack?.split('\n').slice(0, 6).join('\n'));
}