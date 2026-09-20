# Public deployment

- Play: https://regicide-arena.onrender.com/
- Source: https://github.com/altacc154321-wq/altacc
- Manage hosting: https://dashboard.render.com/web/srv-danon7ek1f9s739eeujg
- Host: Render Web Service, Node 22, Singapore, Free ($0/month) instance.
- Build: `npm install && npm test`
- Start: `npm start`
- Health check: `/health`
- One instance, with room state in memory. Restarts clear active rooms.

Verified on September 20, 2026: Render deployment succeeded; all 27 tests passed on the hosted build. Two browser clients connected through the public HTTPS address, created/joined a room, readied up, moved legally, and received synchronized combat damage. The browser reported no errors or warnings during the check.

Players do not need this computer or the local development server. Render serves both the game assets and secure WebSocket multiplayer connections. Its free instance can take about a minute to wake after inactivity.

The service uses the public Git repository. For future releases, update the repository and choose **Manual Deploy → Deploy latest commit** in Render if a deployment does not start automatically. The `render.yaml` file records the equivalent service configuration.
