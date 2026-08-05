#!/usr/bin/env node
import { NexusCli } from './index.js';

const cli = new NexusCli();
cli.run(process.argv.slice(2)).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
