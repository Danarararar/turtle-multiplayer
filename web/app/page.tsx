import TurtleGame from "@/components/TurtleGame";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0b0f",
        color: "#fff",
        padding: "24px 16px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <TurtleGame />
    </main>
  );
}
