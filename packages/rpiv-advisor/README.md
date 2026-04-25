# rpiv-advisor

[![npm version](https://img.shields.io/npm/v/@juicesharp/rpiv-advisor.svg)](https://www.npmjs.com/package/@juicesharp/rpiv-advisor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Escalate decisions to a stronger reviewer model from inside [Pi Agent](https://github.com/badlogic/pi-mono). `rpiv-advisor` registers the `advisor` tool and `/advisor` slash command, implementing the advisor-strategy pattern — the executor forwards the conversation to a reviewer (e.g. Opus), receives guidance (plan, correction, or stop signal), and resumes.

![Advisor model selector](https://raw.githubusercontent.com/juicesharp/rpiv-mono/main/packages/rpiv-advisor/docs/advisor.jpg)

## Install

```bash
pi install npm:@juicesharp/rpiv-advisor
```

Then restart your Pi session.

## Usage

Configure an advisor model with `/advisor` — the command opens a selector for
any model registered with Pi's model registry, plus a reasoning-effort picker
for reasoning-capable models. Selection persists across sessions at
`~/.config/rpiv-advisor/advisor.json` (chmod 0600).

The `advisor` tool is registered at load but excluded from active tools by
default; selecting a model via `/advisor` enables it. Choose "No advisor" to
disable.

`advisor` takes zero parameters — calling it forwards the full serialized
conversation branch to the advisor model, which returns guidance (plan,
correction, or stop signal) that the executor consumes.

## License

MIT
