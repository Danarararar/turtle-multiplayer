# Turtle Multiplayer

A two-player web game for ROS 2 `turtlesim`. Two people control two turtles from two different IP addresses. Any further IP address becomes a spectator.

This is a **local network demo**. Do not deploy it to Vercel: a page served over `https` cannot open a `ws://` connection.
<img width="1223" height="797" alt="Screenshot 2026-10-25 213638" src="https://github.com/user-attachments/assets/b70cd483-d42e-45fd-b68c-2de4c8938a7c" />
<img width="1201" height="767" alt="Screenshot 2026-10-25 211356" src="https://github.com/user-attachments/assets/757919c0-1b59-4673-ae12-fbd3b24c914d" />


## How it works

```
Player 1 browser (WASD)  ─┐
                          ├─ WebSocket ─► Gateway (TypeScript) ─► rosbridge ─► turtlesim
Player 2 browser (arrows) ─┘
```

- `gateway/` is a TypeScript program (`ws`). Browsers talk only to the gateway. Only the gateway talks to rosbridge.
- `web/` is a Next.js page that draws both turtles on a canvas and sends movement intent to the gateway.

| Role | Who | Turtle | Control |
|---|---|---|---|
| Player 1 | first IP address that connects | `turtle1` | keyboard W A S D |
| Player 2 | second IP address that connects | `turtle2` | arrow buttons on the page |
| Spectator | any further IP address | none | cannot move anything |

The role is decided by the gateway from the client IP address, never from anything the browser sends. When a player leaves, the slot becomes free for the next IP address that connects.

## Requirements

- Ubuntu with ROS 2, plus the packages `turtlesim` and `rosbridge_server`
  ```bash
  sudo apt install ros-$ROS_DISTRO-turtlesim ros-$ROS_DISTRO-rosbridge-server
  ```
- Node.js 20 or newer
- If you run Ubuntu in a VM, set the network adapter to **Bridged** so other devices can reach it

## Run from a clean clone

```bash
git clone https://github.com/Danarararar/turtle-multiplayer.git
cd turtle-multiplayer
(cd gateway && npm install)
(cd web && npm install)
```

Find the machine's LAN IP with `hostname -I`.

Allow that address in `web/next.config.ts` (needed so `next dev` serves pages to other IP addresses):

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};
```

Open four terminals. In each one, make sure ROS 2 is sourced (`source /opt/ros/<distro>/setup.bash`) for the first two.

```bash
# 1. turtlesim
ros2 run turtlesim turtlesim_node

# 2. rosbridge (port 9090)
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# 3. gateway (port 8080)
cd gateway && npm run dev

# 4. web (port 3000)
cd web && npm run dev
```

## Test with two IP addresses

1. Open `http://localhost:3000`. This is **Player 1** (keys W A S D).
2. Open `http://<LAN IP>:3000` in another tab, or on a phone or another computer on the same network. This is **Player 2** (arrow buttons).
3. Open the page from a third device to see the **spectator** role.

Keep the browser tab in front while testing: background tabs are throttled by the browser.

![Test with two IP addresses](docs/two-ip-test.png)

## Gateway details

| Setting | Value |
|---|---|
| WebSocket port | `8080` (`PORT` environment variable) |
| rosbridge URL | `ws://localhost:9090` (`ROSBRIDGE_URL` environment variable) |
| Max linear / angular speed | 2.0 / 2.0 (client only sends -1, 0 or 1) |
| Max messages per client | 30 per second |
| Auto stop | 300 ms without a command, or when the player disconnects |

`turtle2` is created by the gateway with the `/spawn` service. If `turtle2` already exists (for example after restarting the gateway), the gateway continues without crashing.

## Requirements checklist

| No | Done in |
|---|---|
| B1 gateway in TypeScript, only gateway talks to rosbridge | `gateway/src/index.ts` |
| B2 role from client IP | `assignRole` |
| B3 `turtle2` via `/spawn`, safe on restart | `onRosOpen`, `onRosMessage` |
| B4 both pages show both turtles and the role | `web/components/TurtleGame.tsx` |
| B5 players move only their own turtle | `onClientMessage` |
| B6 stop on release, silence or disconnect | watchdog timer, `onClientClose` |
| B7 speed and rate limit | `MAX_LINEAR`, `MAX_ANGULAR`, `MAX_MSG_PER_SEC` |
| B8 slot freed when a player leaves | `onClientClose` |
| B9 runs from a clean clone, two-IP screenshot | this README |
