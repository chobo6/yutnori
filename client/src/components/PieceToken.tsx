// client/src/components/PieceToken.tsx
import { characterImage } from "../game/characterAssets";
import styles from "./PieceToken.module.css";

export function PieceToken({
  character,
  team,
  size,
}: {
  character: string;
  team: "A" | "B" | "";
  size: "board" | "corner";
}) {
  const sizeClass = size === "board" ? styles.board : styles.corner;
  return (
    <img
      src={characterImage(character, team)}
      alt={character}
      className={`${styles.token} ${sizeClass}`}
    />
  );
}
