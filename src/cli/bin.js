#!/usr/bin/env node
// The installed command. It holds no words and writes nothing itself: every decision is made in
// src/cli/main.js and everything a reader sees leaves through src/cli/out.js, where the gates look.

import { run } from './main.js';

process.exitCode = await run();
