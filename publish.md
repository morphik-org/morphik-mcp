# Publishing @morphik/mcp

This document outlines the process for publishing the @morphik/mcp package to the npm registry.

## Prerequisites

- Node.js >= 16.0.0
- npm account with access to the @morphik organization
- Git repository access

## Preparation

1. Update the version in `package.json` following [semantic versioning](https://semver.org/) principles:
   - MAJOR version for incompatible API changes
   - MINOR version for backwards-compatible functionality additions
   - PATCH version for backwards-compatible bug fixes

2. Ensure all changes are committed to the repository

## Publishing Process

### 1. Run a Dry-Run First

To verify what files will be included in the package without actually publishing:

```bash
npm pack --dry-run
```

This will list all files that would be included in the published package.

### 2. Build the Package

```bash
npm run build
```

### 3. Login to npm

```bash
npm login
```

Follow the prompts to enter your username, password, and 2FA code if enabled.

### 4. Publish the Package

For a final dry-run that creates the tarball but doesn't publish:

```bash
npm pack
```

To publish to npm:

```bash
npm publish --access public
```

The `--access public` flag is required for scoped packages (@morphik/mcp) on their first publish.

### 5. Verify Publication

Check that your package appears on npm:

```bash
npm view @morphik/mcp
```

## Troubleshooting

- If you get errors about the package being private, make sure the `"private": true` field is not in your package.json
- If you get permission errors, ensure you have the right access to the @morphik organization
- If you need to unpublish a version (within 72 hours):
  ```bash
  npm unpublish @morphik/mcp@<version>
  ```

## Notes

- Remember to update the README.md with any API changes
- Tag the release commit in git:
  ```bash
  git tag -a v<version> -m "Release v<version>"
  git push origin v<version>
  ```