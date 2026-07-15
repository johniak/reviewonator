# Contributing to Reviewonator

Thank you for helping improve Reviewonator. Small, focused changes with clear tests are the easiest to review and maintain.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before a large feature or architectural change so the approach can be discussed first.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Bun 1.3.13 or a compatible newer version and GitHub CLI.

```sh
git clone https://github.com/johniak/reviewonator.git
cd reviewonator
bun install --frozen-lockfile
bun run check
```

Run the application against a pull request and review JSON file with:

```sh
bun run dev -- https://github.com/owner/repository/pull/123 --review-file path/to/review.json
```

## Project expectations

- Keep all application UI and user-facing copy in English.
- Design behavior for testability from the start.
- Prefer established libraries for solved problems.
- Keep implementations small, readable, and maintainable.
- Cover every behavior change with tests.
- Exercise real behavior and integrations where practical. Mock only when there is no reasonable alternative.
- Preserve the human confirmation boundary: no review may be published without a clear user action and final preview.
- Never send GitHub credentials to the browser or persist them in review files.

## Pull requests

Before opening a pull request:

```sh
bun run check
```

Your pull request should explain the problem, the chosen solution, and how it was tested. Include screenshots or a short recording for visible UI changes. Keep unrelated refactors out of the same pull request.

By contributing, you agree that your contribution is licensed under the project's MIT License.
