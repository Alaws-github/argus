# Install and run

**Who:** anyone setting up the app. **You need:** Node.js 20.12 or later, and the project folder.

1. Open a terminal in the `governance-harness` folder (in VS Code: Terminal, New Terminal).
2. Install the parts it needs (first time only, or after an update that adds packages):
   ```
   npm install
   ```
3. Start it:
   ```
   npm run dev
   ```
4. Open http://localhost:5173 in a browser.
5. To stop it, click in the terminal and press **Ctrl+C**.

The first start creates a demo engagement called **Client Zero** with four example use cases, so you can try everything straight away.

## Running it for others (production)

```
npm run build
npm start
```

This serves the whole app on http://localhost:4300. Before letting other people use it, see [Back up and restore](backup-and-restore.md) and the "Before you put it on a server" section of the project README: put it behind HTTPS, set `COOKIE_SECURE=true` and a `SECRET_KEY`.

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| `npm` is not recognised | Install Node.js from nodejs.org, then open a new terminal |
| Port 5173 or 4300 is already in use | The app is already running in another terminal. Stop that one first |
| You can't sign in | See [Reset and recovery](reset-and-recovery.md) |
