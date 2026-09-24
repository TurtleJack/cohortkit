# Release process

CohortKit ships from the `main` branch with git tags.

## Cutting a release

1. Ensure CI is green on `main` (`npm run check`, plus the Postgres job).
2. Update the version in `package.json` following semantic versioning.
3. Update `CHANGELOG.md` with the notable changes.
4. Commit, tag, and push:

```sh
git tag v0.2.0
git push origin main --tags
```

5. Create a GitHub release from the tag with the changelog entries.

## What ships

The repository is the distribution. Self-hosters run:

```sh
docker compose up
# or
npm install && npm run dev
```

The published Docker image (when configured in CI) is built from the same tag.

## Compatibility notes

- SQLite database files are forward-compatible across releases via additive migrations. Back up before upgrading (`npm run backup`) and restore the matching backup if you roll back the application.
- Configuration variable names are stable; new releases may add variables with defaults that match previous behavior.
- The API under `/api` is internal to the frontend; breaking changes are announced in the changelog.