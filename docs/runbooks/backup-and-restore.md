# Back up and restore

Everything the app holds is in the `data` folder inside the project:

| Item | What |
| --- | --- |
| `data/pglite` | The database |
| `data/evidence` | Evidence files |
| `data/secret.key` | The key that decrypts saved AI provider keys |

Back them up together. Without `secret.key`, saved provider keys can't be read (you can re-enter them).

## Back up

1. Stop the app (Ctrl+C in its terminal). The database must not be copied while the app is running.
2. Copy the whole `data` folder somewhere safe, named with the date.
3. Start the app again.

## Restore

1. Stop the app.
2. Rename the current `data` folder (keep it until you're sure).
3. Copy the backup in as `data`.
4. Start the app.

If you use a real Postgres (`DATABASE_URL`), back up the database with your usual Postgres tools, and still back up `data/evidence` and `data/secret.key`.
