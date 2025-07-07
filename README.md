# epic-progress

A tool to fetch an Epic's sub-issues and get its progress

## Requirements

- NodeJS >18
- The issues must be associated to a Github Project

### Configuration

1. `npm install`
2. Create `.env`
   - `GH_TOKEN=ghp_your_personal_token_here`
   - The Token needs to have access to the repo permissions

## Usage

```shell
node epic-progress.mjs --project-url <Project URL> --epic-url <Epic URL> [--milestone <milestone name>]
```

Example:
```shell
$ node epic-progress.mjs --project-url https://github.com/orgs/status-im/projects/65 --epic-url https://github.com/status-im/status-desktop/issues/17971 --milestone 2.35.0

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
⏭️ Skipping issue #18298 — not in milestone "2.35.0" (found: "2.36.0")
----- Epic Progress -----
Progress: 92% 🟩🟩🟩🟩🟩
Done: 8, Code Review: 0, In Progress: 1, Not Started: 0
```