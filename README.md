# epic-progress

A tool to fetch an Epic's sub-issues and get its progress

## Requirements

- NodeJS >18

### Configuration

1. `npm install`
2. Create `.env`
   - `GH_TOKEN=ghp_your_personal_token_here`

## Usage

```terminal
node epic-progress.js GITHUB_EPIC_URL
```

Example:
```
$ node epic-progress.mjs https://github.com/status-im/status-desktop/issues/17971
[dotenv@17.0.0] injecting env (1) from .env – 🔐 encrypt with dotenvx: https://dotenvx.com
Issue #18032 status: done
Issue #18030 status: done
Issue #18031 status: done
Issue #18059 status: done
Issue #18085 status: done
Issue #18090 status: done
Issue #18137 status: done
Issue #18167 status: done
Issue #18256 status: progress
----- Epic Progress -----
Progress: 92% 🟩🟩🟩🟩🟩
Done: 8, Code Review: 0, In Progress: 1, Not Started: 0
```