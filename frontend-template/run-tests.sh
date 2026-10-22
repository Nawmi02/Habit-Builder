#!/usr/bin/env bash
# Runs the pure-logic tests (no Expo / React Native needed).
# Needs: node >= 20 and `ts-node` + `typescript` + `@types/node` (npm i -D ts-node typescript @types/node).
set -e
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node","target":"ES2022","lib":["ES2022","DOM"],"types":[],"ignoreDeprecations":"6.0"}'
# TZ is pinned so the reminder tests are deterministic on every machine.
TZ=Asia/Dhaka node --require ts-node/register/transpile-only --test tests/*.test.ts
