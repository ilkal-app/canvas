# Changesets

A changeset says what a change means for users of `@ilkal/sdk`, and how much it moves the
version. Add one with `pnpm changeset` in any pull request that users will notice. Until 1.0, a
minor version may break the API; say so in the changeset.

To release, a maintainer runs `pnpm changeset version`, which turns the changesets into the
changelog and the new version, merges that, and pushes the tag `v<version>`. The release
workflow then publishes to npm with provenance.
