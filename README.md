# Regicide — The Royal Arena

**Play online: [regicide-arena.onrender.com](https://regicide-arena.onrender.com/)**

The public game runs on Render independently of your computer. Open the link, create a duel, share the invite, and both players select Ready. Free hosting may take about a minute to wake after inactivity.

A playable real-time 1v1 chess arena fighter: two human players, one chess class each, one floating 8×8 board. A Three.js client renders the arena and an authoritative Node/WebSocket server validates every move, attack, cooldown, and hit.

## Run locally

Install Node.js 20 or newer, then run:

```sh
npm install
npm start
```

Open **http://localhost:3000** in a current desktop browser with WebGL support. Create a room, choose a class, and share its six-character code. The other player opens the same server address and joins using that code. Both players select **Ready** to begin.

To try both sides on one computer, open two browser windows/tabs and create/join the same room. Each connection controls one human player; there are no bots or spectators. Chrome, Edge, and Firefox are suitable desktop browsers.

## Play with another person

On the same network, run the server on one computer. Both players open `http://HOST-LAN-IP:3000` (for example, `http://192.168.1.25:3000`). On Windows, `ipconfig` shows the host's IPv4 address. Allow Node or TCP port 3000 through the host firewall on the private network if needed. `localhost` always refers to the current player's own computer.

For players on different networks, deploy this project to a **persistent Node.js host that supports WebSockets**, or run the included Docker image. Serve it through an HTTPS reverse proxy that supports WebSocket upgrades; the client automatically uses secure WebSockets on HTTPS pages. Share the deployed URL and the room code. A room code only identifies a room on the same server; it does not host or publish the server.

```sh
docker build -t regicide-arena .
docker run --rm -p 3000:3000 regicide-arena
```

The server honors `PORT` (default `3000`) and `HOST` (default `0.0.0.0`). `GET /health` returns a small JSON health check. Rooms are held in memory, so use one server instance; restarting it clears active rooms. Horizontal scaling would require shared room routing and storage.

## Publish a public browser link with Render

1. Put this project in a GitHub repository (exclude `node_modules`, `.pnpm-store`, and `.env`).
2. In the [Render dashboard](https://dashboard.render.com/), select **New → Web Service** and connect that repository.
3. Choose **Node** as the runtime, `npm install` as the build command, and `npm start` as the start command. Set the health-check path to `/health` and keep one instance.
4. Deploy. Render provides an HTTPS address such as `https://your-game.onrender.com`.
5. Both players open that public address. One creates a duel and shares the invite link; the other joins. Both select **Ready**.

Use a **Web Service** because the multiplayer server needs a running Node process and WebSocket connections. The app handles Render's `PORT` and switches to secure `wss` automatically. No custom domain is required. Free instances are suitable for testing but sleep after 15 minutes without traffic and may take about a minute to wake. Active rooms reset when the server restarts.

References: [Node deployment](https://render.com/docs/deploy-node-express-app), [WebSocket support](https://render.com/docs/websocket), [free-instance limits](https://render.com/docs/free).

## Chess combat

Movement and attacks happen in real time; the players never alternate turns. Choose a highlighted destination to perform a legal board move. Attacks target a square and resolve after a visible windup, so the opponent can dodge into a different legal square. Attacks can be baited into empty squares. Blue/green targeting marks movement and red marks capture patterns.

| Control | Action |
| --- | --- |
| Q / E | Select movement / attack targeting. |
| Click a highlighted board or tactical-map square | Commit the selected action. |
| Space | Attack the rival's current square if it is a legal capture target. |
| Drag / scroll | Rotate the third-person camera / zoom. |
| R | Reset the camera. |
| Arrow keys / Enter | Select a square / commit. |
| Controller left stick / right stick | Select squares / rotate camera. |
| Controller A / X / Y | Commit / attack targeting / movement targeting. |

| Class | Movement and attack identity |
| --- | --- |
| Pawn | Forward one square, or two on its first move; attacks one square diagonally forward. White advances toward rank 8 and Black toward rank 1. |
| Knight | Jumps in an L shape, ignoring intervening pieces; strikes L-shaped capture squares. |
| Bishop | Dashes and attacks diagonally. |
| Rook | Charges and attacks along rows and columns. |
| Queen | Uses rows, columns, and diagonals; lower health and a longer attack cooldown. |
| King | Moves and attacks one adjacent square; highest health and strong close-range damage. |

Sliding pieces cannot pass through the opponent. Movement cannot enter an occupied square. An attack only deals damage if the opponent still occupies the targeted square at impact. Cooldowns and action locks are checked on the server. Logical occupancy changes when a legal movement starts; its animation shows the transition.

Pawns follow the requested forward-only movement throughout the match. There is no promotion or automatic turnaround at the far rank, so advancing a pawn is a tactical commitment. If neither player could ever reach a position from which they can attack the other—for example, two pawns that have passed each other—the match ends in a draw and offers a rematch. Bishops retain their square color. No unrestricted walking, turn-based chess, check/checkmate, castling, en passant, or automatic board captures are used.

Reduce the opponent's HP to zero to win. Impacts resolve in timestamp order; simultaneous lethal hits produce a draw. Both players can request an instant rematch with the same selected classes. A disconnected player has 30 seconds to reconnect before forfeiting. The reconnect token stays private to that player's browser session and is never included in the room's public state.

## Checks and project layout

```sh
npm test
```

The tests cover chess geometry and blocking plus real WebSocket sessions: room capacity, ready/start, legal/illegal actions, cooldowns, delayed damage, dodged attacks, reconnects, disconnect forfeits, rematches, dead-position draws, and protected static files.

- `public/`: browser UI, third-person scene, procedural models, and effects.
- `shared/rules.js`: deterministic class stats and chess movement/capture geometry shared by browser and server.
- `server.js`: static hosting, room sessions, and authoritative real-time match simulation.
- `tests/`: Node's built-in test runner, including multiplayer integration tests.

The game uses procedural geometry and effects, with no paid assets or external account required. Three.js and WebSocket dependencies are served by the same local server.
