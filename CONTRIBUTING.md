# Contributing

Thank you for helping. This repository holds the source of `@ilkal/sdk`, an embeddable infinite
canvas. Bug reports, fixes, tests and documentation are all welcome.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. To report a security problem, follow
[SECURITY.md](SECURITY.md) and do not open a public issue.

## Build and test

You need Node 22.13 or later and pnpm (the version in `package.json`'s `packageManager`; run
`corepack enable` and it is picked up for you).

```sh
pnpm install
pnpm build      # every package, in dependency order
pnpm test       # every unit test
pnpm lint
pnpm typecheck
```

`pnpm vitest --project @canvas/<name>` runs one package's tests and watches for changes. Each
package's README says what the package does and how it is tested.

This repository's CI runs on GitHub-hosted runners, which have no GPU, so it does not check how
the canvas draws. If your change affects drawing, say so in the pull request and include
before-and-after screenshots from a browser with WebGPU or WebGL2. A maintainer checks it on real
GPUs before accepting it.

## Sign off your commits (DCO)

We use the [Developer Certificate of Origin](DCO) instead of a contributor licence
agreement. There is nothing to sign. Each commit carries a line saying that you wrote the change,
or have the right to submit it, under this project's licence:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you, using the name and email in your git config. Use your real name.
A pull request whose commits are not all signed off fails the DCO check. To sign off commits you
have already made, run `git rebase --signoff main` and force-push your branch.

By signing off, you certify the four points of the [DCO](DCO). In short:

- **(a)** you wrote the contribution and may submit it under the project's licence; or
- **(b)** it is based on earlier work under a compatible open-source licence, and you may submit
  it with your changes under this project's licence; or
- **(c)** someone who certified (a), (b) or (c) gave it to you, and you have not changed it; and
- **(d)** you understand that the contribution and your sign-off are public and kept
  indefinitely.

## Licence of your contribution

This project is licensed under the [Apache License, Version 2.0](LICENSE). What you contribute is
licensed under the same terms (inbound = outbound, section 5 of the licence). We do not ask you to
assign copyright, and we cannot relicense your contribution under other terms.

The name "Ilkal" is not covered by the licence: see [TRADEMARKS.md](TRADEMARKS.md).

## Pull requests

1. For anything larger than a small fix, open an issue first, so we can agree on the approach
   before you spend time on it.
2. Keep a pull request to one change. Add or update tests for what you change.
3. `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm typecheck` pass locally, and CI is green.
4. Every new export has a TSDoc comment.
5. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix:`, `feat:`, `docs:`, …), and every commit is signed off.

A maintainer reviews each pull request. We may ask for changes, and we explain a decision not to
accept one.

## How accepted changes land

This repository is exported from the maintainers' private repository, where the SDK is developed
alongside the hosted Ilkal service. When we accept your pull request, we port it into the private
repository with your authorship and sign-off kept, and it comes back here with the next export.
The pull request is then closed with a link to the commit that carries it, rather than merged
directly.

## Releases

Releases are versioned with [Changesets](https://github.com/changesets/changesets). If your change
affects users of `@ilkal/sdk`, add a changeset (`pnpm changeset`) describing it. The maintainers
publish releases; until 1.0, a minor version may include breaking changes.
