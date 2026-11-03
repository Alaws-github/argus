# Versions, going back, and GitHub

**Who:** whoever runs ARGUS. **You need:** git, and for GitHub, a GitHub account with access to the repository.

Every release of ARGUS is saved as a version in git, from v0.3 to the current one, so you can go back to any of them and come forward again.

## See the versions

```
npm run versions
```

It lists every version with a one-line note, and marks the one you're on.

## Go back to an earlier version

1. Stop the app.
2. Commit anything you changed yourself (or ask for help if you're not sure).
3. Run `npm run versions -- use v1.1` (or any version from the list). It copies your `data` folder into `data-backups/` first.
4. Run `npm install`, then start the app as usual.

An older version may not understand a database made by a newer one. If it won't start, reset the database (`npm run db:reset`) and load the demo again, or copy the backup back once you return to the newer version.

## Come back to the latest

```
npm run versions -- latest
npm install
```

## Put it on GitHub

The repository is https://github.com/Alaws-github/argus. The project folder is already a git repository with the full history, so you only need to connect it and push. Nothing here needs a password or token typed into ARGUS or sent to anyone: git uses your own GitHub sign-in.

In VS Code, open a terminal in the project folder (`governance-harness`) and run:

```
git remote add origin https://github.com/Alaws-github/argus.git
git push -u origin main --tags
```

The first push opens a GitHub sign-in in your browser (Git Credential Manager, which comes with Git for Windows). Sign in and approve.

- **"remote origin already exists"**: run `git remote set-url origin https://github.com/Alaws-github/argus.git` instead of the first line.
- **"rejected ... fetch first"**: the GitHub repository already has commits (for example a README made when it was created). If they don't matter, run `git push -u origin main --tags --force` once. If they do, run `git pull origin main --allow-unrelated-histories`, then push.
- **Keep it private** if the repository holds anything about a real client. The demo data is fictional.

What is not pushed: `node_modules`, the `data` folder (your database, evidence files and the secret key), backups and build output. See `.gitignore`.

## Saving your own changes as a version

```
git add -A
git commit -m "What you changed"
git tag -a v1.3 -m "v1.3: what this version adds"
git push --follow-tags
```
