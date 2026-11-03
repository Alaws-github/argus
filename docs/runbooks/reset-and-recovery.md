# Reset and recovery

## You can't sign in

| Situation | Fix |
| --- | --- |
| Forgot your password | Ask an admin to reset it (People and roles, Reset password) |
| You're the only admin and forgot it | Reset the database (below). Everything is lost, so restore a backup instead if you have one |
| The test scripts were run | They create test accounts (andrew@example.com and others, password `correct-horse-9`). Sign in with those, or reset |
| Sign-in fails for everyone, or the app errors on start | The database may be damaged. Restore a backup, or reset |

## Reset the database

This deletes every account and record and recreates the Client Zero demo.

1. **Stop the app first** (Ctrl+C in its terminal). The reset refuses to run while the app is running, because doing both at once damages the database.
2. Run:
   ```
   npm run db:reset
   ```
3. Start the app (`npm run dev`) and create the first admin again.

The reset also recovers a damaged embedded database, because it starts from an empty folder. `data/secret.key` is kept.
