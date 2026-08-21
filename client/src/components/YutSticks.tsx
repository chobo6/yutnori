import { useEffect, useRef } from "react";
import Matter from "matter-js";
import styles from "./YutSticks.module.css";

const STICK_COUNT = 4;
const CANVAS_WIDTH = 280;
const CANVAS_HEIGHT = 200;
/** 굴러떨어지는 연출 시간(ms) — 이 시간이 지나면 실제 결과에 맞는 자세로 강제 안착시킨다. */
const TUMBLE_MS = 1200;

const FACE_FLAT = "#f5e6c8"; // 배(평평한 면) 위 — 넘어가지 않은 쪽
const FACE_ROUND = "#8b5a2b"; // 등(둥근 면) 위 — 결과 판정에 반영되는 쪽
/** 넷 중 하나(index 0)에만 표시되는 테두리 — 전통 윷놀이의 "표식 있는 가락"과 동일한 역할로,
 * 등이 1개만 나왔을 때 이게 도인지 빽도인지 가른다. */
const MARKED_STROKE = "#c0392b";

/**
 * 전통 윷놀이 물리 규칙: 등(둥근 면)이 위로 온 가락 개수로 결과가 정해진다
 * (0개=모, 1개=도/빽도, 2개=개, 3개=걸, 4개=윷). 빽도는 "표식 있는 가락(index 0)"이
 * 등을 보일 때만 성립 — 나머지 3개 중 하나가 등이면 그냥 도.
 * 반환값의 각 원소는 그 인덱스 가락이 "등이 위"인지 여부.
 */
function targetFaces(result: string): boolean[] {
  switch (result) {
    case "mo":
      return [false, false, false, false];
    case "do":
      return [false, true, false, false];
    case "backDo":
      return [true, false, false, false];
    case "gae":
      return [true, true, false, false];
    case "geol":
      return [true, true, true, false];
    case "yut":
      return [true, true, true, true];
    default:
      return [false, false, false, false];
  }
}

/** 결과가 확정되는 순간(gaugePhase === "resolved") 윷가락 4개가 굴러떨어지는 연출. */
export function YutSticks({ result }: { result: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = Matter.Engine.create();
    const render = Matter.Render.create({
      element: container,
      engine,
      options: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        wireframes: false,
        background: "#e8ddc7",
      },
    });

    const ground = Matter.Bodies.rectangle(CANVAS_WIDTH / 2, CANVAS_HEIGHT + 10, CANVAS_WIDTH, 20, {
      isStatic: true,
    });
    const leftWall = Matter.Bodies.rectangle(-10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT, { isStatic: true });
    const rightWall = Matter.Bodies.rectangle(CANVAS_WIDTH + 10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT, {
      isStatic: true,
    });

    const sticks = Array.from({ length: STICK_COUNT }, (_, i) =>
      Matter.Bodies.rectangle(40 + i * 55, 20, 18, 90, {
        friction: 0.6,
        restitution: 0.3,
        render: {
          fillStyle: FACE_FLAT,
          strokeStyle: i === 0 ? MARKED_STROKE : "#3a2a1a",
          lineWidth: i === 0 ? 3 : 1,
        },
      }),
    );

    Matter.Composite.add(engine.world, [ground, leftWall, rightWall, ...sticks]);

    for (const stick of sticks) {
      Matter.Body.setVelocity(stick, { x: (Math.random() - 0.5) * 4, y: 0 });
      Matter.Body.setAngularVelocity(stick, (Math.random() - 0.5) * 0.5);
    }

    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    let settleTimeout: ReturnType<typeof setTimeout> | undefined;
    if (result) {
      const faces = targetFaces(result);
      settleTimeout = setTimeout(() => {
        sticks.forEach((stick, i) => {
          Matter.Body.setVelocity(stick, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(stick, 0);
          Matter.Body.setPosition(stick, { x: 40 + i * 55, y: CANVAS_HEIGHT - 50 });
          Matter.Body.setAngle(stick, (Math.random() - 0.5) * 0.3);
          stick.render.fillStyle = faces[i] ? FACE_ROUND : FACE_FLAT;
        });
      }, TUMBLE_MS);
    }

    return () => {
      if (settleTimeout) clearTimeout(settleTimeout);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      render.canvas.remove();
    };
  }, [result]);

  return <div ref={containerRef} className={styles.canvasWrap} />;
}
