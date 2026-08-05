/**
 * Example: minimal chat client using the SDK.
 *
 * Run: tsx examples/chat.ts
 */
import { NexusClient } from '../packages/sdk/src/index.js';

async function main(): Promise<void> {
  const client = new NexusClient({
    baseUrl: process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787',
    apiKey: process.env['NEXUS_API_KEY'],
  });

  // Non-streaming
  console.log('--- Non-streaming ---');
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say hello in 3 languages.' },
    ],
  });
  console.log((response as { choices: Array<{ message: { content: string } }> }).choices[0]?.message.content);

  // Streaming
  console.log('\n--- Streaming ---');
  const stream = (await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    stream: true,
  })) as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>;

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
  }
  console.log('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
