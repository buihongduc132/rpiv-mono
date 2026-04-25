# rpiv-ask-user-question

[![npm version](https://img.shields.io/npm/v/@juicesharp/rpiv-ask-user-question.svg)](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Let the model ask a structured clarifying question instead of guessing. `rpiv-ask-user-question` adds the `ask_user_question` tool to [Pi Agent](https://github.com/badlogic/pi-mono) — a structured option selector with an optional free-text "Other" fallback.

![Structured question prompt](https://raw.githubusercontent.com/juicesharp/rpiv-mono/main/packages/rpiv-ask-user-question/docs/prompt.jpg)

## Install

```bash
pi install npm:@juicesharp/rpiv-ask-user-question
```

Then restart your Pi session.

## Tool

- **`ask_user_question`** — present a structured question with 2+ options and
  (optionally) a multi-select toggle. Returns the user's selection or free-text
  answer. See the tool's `promptGuidelines` for usage policy.

## License

MIT
