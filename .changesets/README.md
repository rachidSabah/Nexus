# Changesets

This folder uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs.

## Adding a changeset

Run `pnpm changeset` and follow the prompts. A new `.md` file will appear in this folder.

## How it works

- Each changeset describes a change to one or more packages.
- On release, changesets are consumed and bump versions automatically.
- The first release that has changesets creates a new version for each affected package.
