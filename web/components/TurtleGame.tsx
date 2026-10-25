"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const GATEWAY_PORT = 8080;
const WORLD = 11; // area turtlesim: 11 x 11 unit
const SIZE = 500; // ukuran canvas (px)

type Role = "player1" | "player2" | "spectator";
type TurtleName = "turtle1" | "turtle2";
type Control = "up" | "down" | "left" | "right";
type Pose = { x: number; y: number; theta: number };

type ServerMessage =
  | { type: "role"; role: Role }
  | { type: "players"; player1: boolean; player2: boolean }
  | { type: "pose"; turtle: TurtleName; x: number; y: number; theta: number };

const ROLE_TEXT: Record<Role, string> = {
  player1: "You are Player 1 (turtle1). Control: W A S D",
  player2: "You are Player 2 (turtle2). Control: arrow buttons below",
  spectator: "You are a spectator. You can watch but not move.",
};

function keyToControl(key: string, role: Role | null): Control | null {
  if (role === "player1") {
    const k = key.toLowerCase();
    if (k === "w") return "up";
    if (k === "s") return "down";
    if (k === "a") return "left";
    if (k === "d") return "right";
  }
  if (role === "player2") {
    if (key === "ArrowUp") return "up";
    if (key === "ArrowDown") return "down";
    if (key === "ArrowLeft") return "left";
    if (key === "ArrowRight") return "right";
  }
  return null;
}

function PadButton(props: {
  label: string;
  control: Control;
  disabled: boolean;
  onChange: (c: Control, down: boolean) => void;
}) {
  const { label, control, disabled, onChange } = props;
  const style: CSSProperties = {
    width: 64,
    height: 64,
    fontSize: 24,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.25)",
    background: disabled ? "#1a1a22" : "#2a2a38",
    color: disabled ? "#555" : "#fff",
    touchAction: "none",
    userSelect: "none",
  };
  return (
    <button
      style={style}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        onChange(control, true);
      }}
      onPointerUp={() => onChange(control, false)}
      onPointerLeave={() => onChange(control, false)}
      onPointerCancel={() => onChange(control, false)}
    >
      {label}
    </button>
  );
}

export default function TurtleGame() {
  const [role, setRole] = useState<Role | null>(null);
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState({ player1: false, player2: false });
  const [poses, setPoses] = useState<Partial<Record<TurtleName, Pose>>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const roleRef = useRef<Role | null>(null);
  const pressed = useRef<Set<Control>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Kirim "niat" gerak ke gateway. Kecepatan ditentukan gateway.
  const sendIntent = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const p = pressed.current;
    const forward = (p.has("up") ? 1 : 0) - (p.has("down") ? 1 : 0);
    const turn = (p.has("left") ? 1 : 0) - (p.has("right") ? 1 : 0);
    ws.send(JSON.stringify({ type: "move", forward, turn }));
  }, []);

  const setControl = useCallback(
    (c: Control, down: boolean) => {
      const had = pressed.current.has(c);
      if (down) pressed.current.add(c);
      else pressed.current.delete(c);
      if (had !== down) sendIntent();
    },
    [sendIntent],
  );

  // Koneksi WebSocket ke gateway. Socket lama diabaikan supaya aman di mode dev (effect jalan dua kali).
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(`ws://${window.location.hostname}:${GATEWAY_PORT}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current === ws) setConnected(true);
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        if (wsRef.current !== ws) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "role") {
          roleRef.current = msg.role;
          setRole(msg.role);
        } else if (msg.type === "players") {
          setPlayers({ player1: msg.player1, player2: msg.player2 });
        } else if (msg.type === "pose") {
          setPoses((prev) => ({
            ...prev,
            [msg.turtle]: { x: msg.x, y: msg.y, theta: msg.theta },
          }));
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // socket lama, abaikan
        wsRef.current = null;
        roleRef.current = null;
        setConnected(false);
        setRole(null);
        if (active) timer = setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, []);

  // Selama tombol ditahan, kirim perintah berulang (gateway akan menghentikan kura-kura kalau berhenti)
  useEffect(() => {
    const id = setInterval(() => {
      if (pressed.current.size > 0) sendIntent();
    }, 100);
    return () => clearInterval(id);
  }, [sendIntent]);

  // Keyboard: W A S D untuk Player 1, panah untuk Player 2 (opsional)
  useEffect(() => {
    const handler = (down: boolean) => (e: KeyboardEvent) => {
      const c = keyToControl(e.key, roleRef.current);
      if (!c) return;
      e.preventDefault();
      setControl(c, down);
    };
    const onDown = handler(true);
    const onUp = handler(false);
    const onBlur = () => {
      if (pressed.current.size > 0) {
        pressed.current.clear();
        sendIntent();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [setControl, sendIntent]);

  // Gambar kedua kura-kura
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#4556ff";
    ctx.fillRect(0, 0, SIZE, SIZE);

    const draw = (name: TurtleName, color: string, label: string) => {
      const p = poses[name];
      if (!p) return;
      const cx = (p.x / WORLD) * SIZE;
      const cy = SIZE - (p.y / WORLD) * SIZE;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.theta);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-12, -12);
      ctx.lineTo(-12, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(label, cx + 14, cy - 14);
    };
    draw("turtle1", "#2ecc71", "P1");
    draw("turtle2", "#f39c12", "P2");
  }, [poses]);

  const padDisabled = role !== "player2";

  return (
    <div style={{ width: "100%", maxWidth: SIZE }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Turtle Multiplayer</h1>

      <p style={{ marginBottom: 4 }}>
        {connected && role ? ROLE_TEXT[role] : "Connecting to gateway..."}
      </p>
      <p style={{ marginBottom: 12, fontSize: 13, color: "#aaa" }}>
        Player 1: {players.player1 ? "taken" : "free"} | Player 2:{" "}
        {players.player2 ? "taken" : "free"}
      </p>

      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{ width: "100%", height: "auto", borderRadius: 12 }}
      />

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(3, 64px)",
          gap: 8,
          justifyContent: "center",
        }}
      >
        <span />
        <PadButton label="▲" control="up" disabled={padDisabled} onChange={setControl} />
        <span />
        <PadButton label="◀" control="left" disabled={padDisabled} onChange={setControl} />
        <PadButton label="▼" control="down" disabled={padDisabled} onChange={setControl} />
        <PadButton label="▶" control="right" disabled={padDisabled} onChange={setControl} />
      </div>
    </div>
  );
}
