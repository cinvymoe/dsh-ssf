#!/usr/bin/env node
// scripts/install-qoder.mjs — deploy spec-superflow for Qoder
// Skills → .qoder/skills/, phase-guard rule → .qoder/rules/phase-guard.md
import { installPlatform } from './lib/install.mjs';

installPlatform('qoder').catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
