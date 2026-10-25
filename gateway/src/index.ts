import { WebSocket, WebSocketServer } from "ws";

// ---------- Konfigurasi ----------
const PORT = Number(process.env.PORT ?? 8080);
const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL ?? "ws://localhost:9090";
const MAX_LINEAR = 2.0; // kecepatan maju maksimum yang diterima (B7)
const MAX_ANGULAR = 2.0; // kecepatan putar maksimum yang diterima (B7)
const MAX_MSG_PER_SEC = 30; // batas pesan per klien per detik (B7)
const STOP_AFTER_MS = 300; // berhenti kalau tidak ada perintah (B6)

type Role = "player1" | "player2" | "spectator";
type TurtleName = "turtle1" | "turtle2";

interface Client {
  ip: string;
  role: Role;
  windowStart: number;
  count: number;
}

const TURTLES: TurtleName[] = ["turtle1", "turtle2"];
const turtleOf: Record<Exclude<Role, "spectator">, TurtleName> = {
  player1: "turtle1",
  player2: "turtle2",
};

const clients = new Map<WebSocket, Client>();
const slots: { player1: string | null; player2: string | null } = {
  player1: null,
  player2: null,
};
const lastCommand: Record<TurtleName, number> = { turtle1: 0, turtle2: 0 };
const moving: Record<TurtleName, boolean> = { turtle1: false, turtle2: false };

// ---------- Bagian rosbridge ----------
let ros: WebSocket | null = null;

function rosSend(payload: object): void {
  if (ros && ros.readyState === WebSocket.OPEN) {
    ros.send(JSON.stringify(payload));
  }
}

function publishTwist(turtle: TurtleName, linear: number, angular: number): void {
  rosSend({
    op: "publish",
    topic: `/${turtle}/cmd_vel`,
    msg: {
      linear: { x: linear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    },
  });
  moving[turtle] = linear !== 0 || angular !== 0;
}

function subscribePose(turtle: TurtleName): void {
  rosSend({
    op: "subscribe",
    topic: `/${turtle}/pose`,
    type: "turtlesim/msg/Pose",
    throttle_rate: 50,
  });
}

function onRosOpen(): void {
  console.log("[ros] tersambung ke rosbridge");
  for (const t of TURTLES) {
    rosSend({
      op: "advertise",
      topic: `/${t}/cmd_vel`,
      type: "geometry_msgs/msg/Twist",
    });
  }
  subscribePose("turtle1");
  // B3: buat turtle2. Kalau sudah ada, balasan result=false dan kita lanjut saja.
  rosSend({
    op: "call_service",
    id: "spawn-turtle2",
    service: "/spawn",
    type: "turtlesim/srv/Spawn",
    args: { x: 7.5, y: 5.5, theta: 0, name: "turtle2" },
  });
  setTimeout(() => subscribePose("turtle2"), 3000); // jaga-jaga kalau balasan tidak datang
}

interface RosMessage {
  op?: string;
  id?: string;
  result?: boolean;
  topic?: string;
  msg?: Record<string, unknown>;
}

function onRosMessage(raw: string): void {
  let m: RosMessage;
  try {
    m = JSON.parse(raw) as RosMessage;
  } catch {
    return;
  }

  if (m.op === "service_response" && m.id === "spawn-turtle2") {
    console.log(m.result ? "[ros] turtle2 dibuat" : "[ros] turtle2 sudah ada, lanjut");
    subscribePose("turtle2");
    return;
  }

  if (m.op === "publish" && m.topic && m.msg) {
    const match = /^\/(turtle[12])\/pose$/.exec(m.topic);
    if (match) {
      broadcast({
        type: "pose",
        turtle: match[1],
        x: Number(m.msg.x),
        y: Number(m.msg.y),
        theta: Number(m.msg.theta),
      });
    }
    return;
  }

  if (m.op === "status") {
    console.warn("[ros] status:", raw);
  }
}

function connectRos(): void {
  const sock = new WebSocket(ROSBRIDGE_URL);
  ros = sock;
  sock.on("open", () => {
    if (ros === sock) onRosOpen();
  });
  sock.on("message", (data) => {
    if (ros === sock) onRosMessage(data.toString());
  });
  sock.on("error", (err) => {
    console.error("[ros] error:", err.message);
  });
  sock.on("close", () => {
    if (ros === sock) {
      ros = null;
      moving.turtle1 = false;
      moving.turtle2 = false;
      console.log("[ros] terputus, coba lagi dalam 2 detik");
      setTimeout(connectRos, 2000);
    }
  });
}

// ---------- Bagian klien (browser) ----------
function normalizeIp(raw: string | undefined): string {
  if (!raw) return "unknown";
  const ip = raw.replace(/^::ffff:/, "");
  return ip === "::1" ? "127.0.0.1" : ip;
}

// B2: peran ditentukan dari IP, bukan dari isi pesan browser.
function assignRole(ip: string): Role {
  if (slots.player1 === ip) return "player1";
  if (slots.player2 === ip) return "player2";
  if (slots.player1 === null) {
    slots.player1 = ip;
    return "player1";
  }
  if (slots.player2 === null) {
    slots.player2 = ip;
    return "player2";
  }
  return "spectator";
}

function send(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(payload: object): void {
  const text = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

function broadcastPlayers(): void {
  broadcast({
    type: "players",
    player1: slots.player1 !== null,
    player2: slots.player2 !== null,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function onClientMessage(ws: WebSocket, raw: string): void {
  const client = clients.get(ws);
  if (!client) return;

  // B7: batasi jumlah pesan per detik
  const now = Date.now();
  if (now - client.windowStart > 1000) {
    client.windowStart = now;
    client.count = 0;
  }
  client.count += 1;
  if (client.count > MAX_MSG_PER_SEC) return;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof data !== "object" || data === null) return;
  const m = data as { type?: unknown; forward?: unknown; turn?: unknown };
  if (m.type !== "move") return;

  // B5: penonton tidak boleh menggerakkan apa pun; pemain hanya kura-kuranya sendiri
  if (client.role === "spectator") return;
  const turtle = turtleOf[client.role];

  // Browser hanya mengirim niat (-1, 0, 1). Kecepatan ditentukan gateway (B7).
  const forward = clamp(Number(m.forward) || 0, -1, 1);
  const turn = clamp(Number(m.turn) || 0, -1, 1);
  lastCommand[turtle] = now;
  publishTwist(turtle, forward * MAX_LINEAR, turn * MAX_ANGULAR);
}

function onClientClose(ws: WebSocket): void {
  const client = clients.get(ws);
  clients.delete(ws);
  if (!client) return;
  console.log(`[gw] ${client.ip} (${client.role}) keluar`);

  // B6: pemain keluar -> kura-kuranya berhenti
  if (client.role !== "spectator") publishTwist(turtleOf[client.role], 0, 0);

  // B8: slot dibebaskan kalau tidak ada lagi koneksi dari IP itu
  const stillHere = [...clients.values()].some((c) => c.ip === client.ip);
  if (!stillHere) {
    if (slots.player1 === client.ip) slots.player1 = null;
    if (slots.player2 === client.ip) slots.player2 = null;
    broadcastPlayers();
  }
}

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

wss.on("connection", (ws, req) => {
  const ip = normalizeIp(req.socket.remoteAddress);
  const role = assignRole(ip);
  clients.set(ws, { ip, role, windowStart: Date.now(), count: 0 });
  console.log(`[gw] ${ip} terhubung sebagai ${role}`);

  send(ws, { type: "role", role });
  broadcastPlayers();

  ws.on("message", (raw) => onClientMessage(ws, raw.toString()));
  ws.on("close", () => onClientClose(ws));
  ws.on("error", (err) => console.error("[gw] error klien:", err.message));
});

// B6: kalau browser berhenti mengirim perintah, kura-kura berhenti
setInterval(() => {
  const now = Date.now();
  for (const t of TURTLES) {
    if (moving[t] && now - lastCommand[t] > STOP_AFTER_MS) {
      publishTwist(t, 0, 0);
    }
  }
}, 100);

process.on("SIGINT", () => {
  for (const t of TURTLES) publishTwist(t, 0, 0);
  process.exit(0);
});

connectRos();
console.log(`[gw] gateway berjalan di port ${PORT}, rosbridge: ${ROSBRIDGE_URL}`);
