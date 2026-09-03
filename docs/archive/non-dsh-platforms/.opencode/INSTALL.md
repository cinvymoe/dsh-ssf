# Installing spec-superflow for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed

## Installation

### Plugin Mode (recommended)

Clone the repository and point OpenCode to the plugin entry:

```bash
git clone https://github.com/cinvymoe/dsh-ssf.git ~/spec-superflow
```

Then in your OpenCode project, reference this plugin file by absolute path in `.opencode/config.json` (or via the UI):

```text
~/spec-superflow/.opencode/plugins/spec-superflow.js
```

Do not copy only `spec-superflow.js` into another project; the plugin reads `../../skills` and `../../GEMINI.md` relative to its own location.

### Manual Skills Symlink

OpenCode discovers agent skills from project skill directories. For a specific project:

```bash
git clone https://github.com/cinvymoe/dsh-ssf.git
mkdir -p your-project/.agents
ln -s /absolute/path/to/spec-superflow/skills your-project/.agents/skills
```

If symlinks are not available, copy instead:

```bash
cp -R /absolute/path/to/spec-superflow/skills your-project/.agents/skills
```

## Usage

Ask OpenCode to use the workflow entry skill:

```
用 workflow-start 开始
```

Or explicitly:

```
/spec-superflow:workflow-start
```

## Troubleshooting

### Skills not found

1. Verify that `.agents/skills/workflow-start/SKILL.md` exists.
2. Restart OpenCode after adding or changing the skill directory.
3. Use a real directory copy instead of a symlink if your environment does not follow symlinks.
