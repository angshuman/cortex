#!/usr/bin/env node
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const mainPath = path.join(__dirname, '..', 'dist', 'electron', 'main.cjs');

const child = spawn(electronPath, [mainPath], {
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));
