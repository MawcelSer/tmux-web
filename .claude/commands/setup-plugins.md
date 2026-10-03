# Setup Plugins

Install recommended Claude Code plugins and configure marketplaces.

## Steps

1. Add recommended marketplaces:
   ```bash
   claude plugin marketplace add anthropics/claude-plugins-official
   claude plugin marketplace add anthropics/claude-code
   claude plugin marketplace add mixedbread-ai/mgrep
   ```

2. Install system dependencies required by plugins:
   ```bash
   npm install -g typescript-language-server typescript @mixedbread/mgrep
   ```

3. Install recommended plugins:
   ```bash
   claude plugin install typescript-lsp
   claude plugin install pr-review-toolkit
   claude plugin install mgrep
   claude plugin install context7
   claude plugin install frontend-design
   claude plugin install playwright
   claude plugin install security-guidance
   ```

4. Verify installations:
   ```bash
   claude plugin list
   typescript-language-server --version
   mgrep --version
   ```

5. Report installed plugins and their status


## Arguments

$ARGUMENTS: Optional — `--list` to show available plugins, or specific plugin name to install individually

## Usage

```
/setup-plugins
/setup-plugins --list
/setup-plugins context7
```
