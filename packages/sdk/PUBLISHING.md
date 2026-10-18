# Publishing @agent-cookie/sdk

For the repository owner, and for the session that publishes on the owner's behalf. Nothing below has been done yet: there is no npm account, no `agent-cookie` organization and no token. Each step says who does it and where.

No token, password, recovery code or one-time code is ever written into this repository, a commit, a log or a chat message. The token lives in one place, the cloud environment's settings, and only for as long as a release takes.

## Where things stand (checked 2026-10-18)

- **The package is ready.** `pnpm run publish:check` in `packages/sdk` runs the build, `pack:smoke` and a publish dry run. It prints the tarball and uploads nothing.
- **The names were free on 2026-10-18.** The public registry had no package named `@agent-cookie/sdk` or `agent-cookie-sdk`. No user or organization owned the scope `agent-cookie`: `https://registry.npmjs.org/-/org/agent-cookie/package` answered `Scope not found`, the same answer a made-up name gets. That was one moment, not a reservation. Anyone can claim the name first, and npm can refuse a name it considers too close to another. You find out in step 2.
- **The GitHub repository is private.** Until it is public, the npm page's Repository, Homepage and Issues links will show a 404 to everyone but you, and `--provenance` is not possible (see step 4). Publishing works either way. Making the repository public is your decision, separate from this checklist.
- **License.** `package.json` says `MIT`, and the text is `LICENSE` at the repository root. `pnpm publish` copies that file into the tarball because the package has no LICENSE of its own. A plain `npm publish` run in `packages/sdk` would leave it out, so publish with pnpm as step 4 shows. `pack:smoke` fails if the LICENSE is missing.

## 1. Create an npm account with two-factor authentication (owner, in a browser)

1. Open https://www.npmjs.com/signup and sign up with your own email address.
   - Choose a personal username that is **not** `agent-cookie`. Users and organizations share one namespace, and step 2 needs `agent-cookie` for the organization.
2. Confirm the email: npm sends a code or a link.
3. Turn on two-factor authentication: avatar (top right), **Account**, **Two-Factor Authentication**, enable it.
   - Prefer a security key or passkey. An authenticator app also works if npm offers it.
   - Keep the recovery codes offline, not in this repository and not in a chat.
   - npm requires two-factor authentication on accounts that publish.

## 2. Create the `agent-cookie` organization (owner, in a browser)

1. Avatar, **Add Organization** (or https://www.npmjs.com/org/create).
2. Name it `agent-cookie` and pick the free plan (unlimited public packages).
3. Skip inviting members.

Your account now owns the scope, and only members of the organization can publish `@agent-cookie/...` packages.

### If `agent-cookie` is taken: publish as `agent-cookie-sdk`

The fallback is the unscoped name `agent-cookie-sdk`. You need no organization for it. Skip step 2 and adjust step 3 as described there. These files change:

In `packages/sdk` (lane B makes these changes):

- `package.json`: `"name": "agent-cookie-sdk"`. Leave `homepage`, `repository` and `bugs` as they are.
- `README.md`: the title, the Install line, every `from '@agent-cookie/sdk'` in the quickstarts and under Errors, the Publishing section, and the `pnpm --filter @agent-cookie/sdk` commands.
- `PUBLISHING.md`: the package name in the commands.
- `scripts/pack-smoke.mjs`: no change. It reads the name from `package.json`.

Outside `packages/sdk` (ask the owning lane through `docs/requests.md`):

- `packages/cli/package.json`, `packages/mcp/package.json` and `apps/channel-photon/package.json`: change the dependency to `"@agent-cookie/sdk": "workspace:agent-cookie-sdk@*"`. That is a pnpm alias, so their source files keep importing `@agent-cookie/sdk` unchanged. Then run `pnpm install` to update `pnpm-lock.yaml`.
- Root `package.json`, in the `build:deps` script: `--filter agent-cookie-sdk`.
- Pages that tell outsiders what to install or import: the root `README.md`, `examples/assistant-sdk/` and `examples/merchant-sdk/` (`main.mjs` and `README.md`), and `skills/agent-cookie/SKILL.md`. To list every mention, run `grep -rn --exclude-dir=node_modules --exclude-dir=dist "@agent-cookie/sdk" .`.
- Then run `pnpm install && pnpm typecheck && pnpm test` and `pnpm --filter agent-cookie-sdk run publish:check`.

## 3. Create a granular access token and store it as `NPM_TOKEN` (owner, in a browser)

1. On npmjs.com: avatar, **Access Tokens**, **Generate New Token**, **Granular Access Token**. The page's wording may differ slightly.
2. Fill in the form:
   - **Name**: `agent-cookie-sdk publish`.
   - **Expiration**: short, for example 7 days. Make a new token for each release.
   - **Packages and scopes**: permission **Read and write**. Choose **Only select packages and scopes** and select the scope `@agent-cookie`. The package does not exist yet, so select the scope, not the package.
     - Fallback name: there is no scope to select. Choose **All packages** for the first publish, then replace the token with one limited to `agent-cookie-sdk`.
   - **Organizations**: **No access**. The token publishes and does not manage the organization.
   - **Allowed IP ranges**: leave empty. The cloud environment has no fixed outbound address.
   - **Bypass two-factor authentication**: tick it if the page offers it. The session publishes without a terminal and cannot type a one-time code. If it is left off, the publish stops with `EOTP`.
3. Generate the token and copy it. npm shows it once.
4. In Claude Code, open the cloud environment menu in the session's title bar and choose **Edit**. Add an environment variable named `NPM_TOKEN` whose value is the token, then save.
   - A session that is already running does not see it. Start a new session for step 4.
   - Do not paste the token into a chat, a commit or an `.npmrc` inside the repository.
5. While `NPM_TOKEN` is set, every session in that environment can read it, along with any code those sessions run, including package install scripts. That is why the token is limited to one scope, expires quickly and is removed after step 5.

## 4. Publish (a session, from `packages/sdk`)

Ask a new session to "publish @agent-cookie/sdk following packages/sdk/PUBLISHING.md step 4". It runs this from the repository root as one command. Shell variables do not carry over between a session's commands, so it is a single heredoc:

```sh
cd packages/sdk && bash -eu <<'SH'
test -n "${NPM_TOKEN:-}" || { echo 'NPM_TOKEN is not set: add it to the environment (step 3), then start a new session'; exit 1; }
pnpm run publish:check                     # build, pack:smoke, publish dry run; any failure stops here
NPMRC="$(mktemp)"; trap 'rm -f "$NPMRC"' EXIT
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$NPMRC"   # holds the variable's NAME; npm reads the value
export NPM_CONFIG_USERCONFIG="$NPMRC"      # a temporary npmrc outside the repository, deleted on exit
npm whoami                                 # your npm username; E401 means a wrong or expired token
pnpm publish --access public
SH
```

- **Read the dry-run listing before the real publish.** It should list `LICENSE`, `README.md`, `package.json` and `dist/` only. A version number can be published once, ever: npm never accepts the same name and version twice, even after an unpublish.
- **Why `pnpm publish`.** pnpm runs `prepack` (the build), packs the tarball the way `pack:smoke` does, and hands it to `npm publish --ignore-scripts <tarball>`. npm does the upload, with the npmrc above. pnpm's packing adds the root LICENSE and rewrites the `workspace:*` dev dependency to a plain version. A plain `npm publish` in this directory would do neither.
- **Git checks.** `pnpm publish` refuses unless the checkout is on `main`, has no uncommitted changes and is level with `origin/main`. That way only merged code gets published. If the session works on another branch, either switch to an up-to-date `main` first, or, if the owner says so, check that `git diff --stat origin/main -- packages/sdk` prints nothing and add `--no-git-checks`.
- **Token as an environment variable instead of an npmrc.** This form works too: `env "NPM_CONFIG_//registry.npmjs.org/:_authToken=$NPM_TOKEN" pnpm publish --access public`. The name contains `/` and `:`, so `export` cannot set it but `env` can. For the length of that one command the token sits in the process's argument list, which the npmrc form avoids.
- **From CI, with provenance.** Add `--provenance`. npm accepts provenance only from a **public** repository, in a GitHub Actions job with `permissions: { contents: read, id-token: write }`. Today the repository is private, so publish from a session without `--provenance`. A workflow under `.github/workflows` is not lane B's directory. A sketch for whoever writes it: `actions/setup-node@v4` with `registry-url: https://registry.npmjs.org` and `node-version-file: .nvmrc`; `pnpm install --frozen-lockfile`; `pnpm --filter @agent-cookie/sdk run publish:check`; then, in `packages/sdk`, `pnpm publish --access public --provenance --no-git-checks` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Later, npm's trusted publishing (OIDC from GitHub Actions, set up on the package's settings page after the first publish, npm 11.5 or later) removes the token from CI entirely.

What a failure means:

| Message | Meaning | Fix |
| --- | --- | --- |
| `E401` from `npm whoami` | The token is wrong, expired or not in the environment | Step 3 again, then a new session |
| `EOTP` / "one-time password" | The token was made without the two-factor bypass | A new token with the bypass ticked. Don't pass one-time codes around |
| `E403`/`E404` on `PUT .../@agent-cookie%2fsdk` | The organization does not exist, or the token is not scoped to it | Step 2, or the token's Packages and scopes |
| `E403` "cannot publish over the previously published versions" | This version is already on npm | Raise `version` in `package.json` (a lane B change) |
| `ERR_PNPM_GIT_UNCLEAN` / `GIT_NOT_LATEST` / branch | pnpm's git checks | See "Git checks" above |
| A 403 from the environment's proxy, not from npm | The network policy denies `registry.npmjs.org` | Allow that host under the environment's Network access |

Reads from `registry.npmjs.org` worked from this environment on 2026-10-18 (`npm view` and `npm whoami` reached it). The upload itself has not been tried.

## 5. Verify (the session, then the owner)

The session runs, from `packages/sdk`:

```sh
npm view @agent-cookie/sdk                  # version 0.1.0, license MIT, dist-tags latest: 0.1.0, no dependencies, your username under maintainers
npm view @agent-cookie/sdk dist.integrity   # the same sha512 the publish printed
node scripts/pack-smoke.mjs --registry 0.1.0
```

The last command repeats `pack:smoke` against what the registry serves. It runs a fresh `npm install @agent-cookie/sdk@0.1.0` in an empty project and checks the installed files: `LICENSE`, `README.md`, `package.json` and `dist/` only, license MIT, no runtime dependencies. It then runs the consumer that imports and constructs every client, without making any network call, and type-checks the TypeScript consumer of the three quickstarts with `skipLibCheck` off. The registry can take a minute or two to serve a new version. An `E404` or `ETARGET` right after publishing means wait and run it again.

A hand check that needs nothing from this repository:

```sh
D="$(mktemp -d)" && cd "$D" && npm init -y >/dev/null && npm i @agent-cookie/sdk@0.1.0 \
  && node --input-type=module -e "import * as sdk from '@agent-cookie/sdk'; console.log(Object.keys(sdk).sort().join(' '))"
```

It prints the 21 exports: `AssistantClient`, `MerchantClient`, `WorkspaceClient`, `registerAgent`, `assistantPrompt`, `isWorkspaceError`, `WorkspaceError`, `LinkNotApprovedError`, `workspaceConfigFromEnv`, `WORKSPACE_ERROR_CODES`, `LINK_TTL_MS`, and the rest.

Then the owner:

1. Open https://www.npmjs.com/package/@agent-cookie/sdk and check that the README renders, version 0.1.0 is `latest` and the license reads MIT.
2. Delete the token on npmjs.com (**Access Tokens**) and remove `NPM_TOKEN` from the environment's settings until the next release.

## Later releases

1. Lane B raises `version` in `package.json` (0.x: a minor bump for a breaking change, a patch bump otherwise) and says what changed in the commit.
2. Once it is merged, repeat steps 3 to 5. The organization and the account stay. Each release gets a fresh, short-lived token.

The README on the npm page is the one inside the tarball. Correcting it takes a new version.
