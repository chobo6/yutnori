import gyoju from "../assets/characters/gyoju.png";
import gyojuRed from "../assets/characters/gyoju_red.png";
import priest from "../assets/characters/priest.png";
import priestRed from "../assets/characters/priest_red.png";
import madam from "../assets/characters/madam.png";
import madamRed from "../assets/characters/madam_red.png";
import uisa from "../assets/characters/uisa.png";
import uisaRed from "../assets/characters/uisa_red.png";

const BLUE: Record<string, string> = {
  교주: gyoju,
  성직: priest,
  마담: madam,
  의사: uisa,
};

const RED: Record<string, string> = {
  교주: gyojuRed,
  성직: priestRed,
  마담: madamRed,
  의사: uisaRed,
};

/** team이 "B"면 빨강, 그 외(팀 미배정 포함)는 파랑. */
export function characterImage(character: string, team: "A" | "B" | ""): string {
  const table = team === "B" ? RED : BLUE;
  return table[character] ?? BLUE[character] ?? "";
}
