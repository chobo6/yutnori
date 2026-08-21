# CLAUDE.md

윷놀이 웹 게임 — "마피아42"의 인게임 미니게임을 Colyseus 기반 실시간 멀티플레이어 웹으로 이식하는 프로젝트. [[project_songpyeon_web_game]]과 같은 계열의 포팅 작업이며 스택/관례를 의도적으로 재사용한다.

## Commands

루트에서:
```bash
npm run dev          # server(2567)+client(5173) 동시 실행. predev가 두 포트 점유 프로세스 먼저 정리함
npm run dev:server   # server만
npm run dev:client   # client만
```

server/:
```bash
npm run dev    # tsx watch src/index.ts
npm test       # vitest run
npm run build  # tsc --noEmit (타입체크만, 산출물 없음)
```

client/:
```bash
npm run dev    # vite
npm run build  # tsc -b && vite build
```
**client에는 자동화 테스트 프레임워크가 없다** — songpyeon과 동일한 확립된 관례. 클라이언트 작업 검증은 `npm run build`(타입체크) + 실제 브라우저 확인(Playwright 또는 수동 다중 탭)으로 한다. 새 클라이언트 기능을 "테스트 통과"로 보고하기 전에 반드시 실제 상호작용(특히 포인터/타이밍 관련 UI)을 브라우저에서 확인할 것 — `docs/TROUBLESHOOTING.md` #9, #10이 코드만 보고 정상이라 판단했다가 실제로는 깨져 있던 사례.

## Architecture

- npm workspaces 모노레포: `client/` (React 19 + TS + Vite + colyseus.js + CSS Modules), `server/` (Node + TS + Colyseus, ESM)
- **서버 권위형(authoritative)**: 말 위치, 턴 순서, 윷 던지기 판정(게이지 타이밍 포함), 승리 판정을 전부 서버(`MatchRoom`/`MatchState`)가 소유. 클라이언트는 입력 메시지만 보내고 state diff를 받아 그리기만 함 — 클라이언트에서 판정 로직을 복제하지 말 것.
- 핵심 게임 규칙은 `server/src/game/` 아래 순수 함수로 분리되어 있고 각각 동명 `*.test.ts`가 있음: `position`(보드 위치/지름길/빽도), `pieces`(이동/잡기/업기), `gauge`(게이지 파형/윷 던지기 서버 판정), `turns`(턴 순서/승리 판정). 새 규칙을 추가할 때도 이 패턴(순수 함수 + 테스트, TDD)을 유지.
- Room 진입점: `server/src/rooms/MatchRoom.ts` (로직 + 타이머), `MatchState.ts` (Colyseus Schema)
- Colyseus 개념 매핑: Room = 한 경기(2팀×2인 고정), Message client→server = `pickTeam`/`pickCharacters`/`ready`(대기실), `throwStart`/`throwRelease`/`movePiece`(플레이). server→client는 state 변경분 자동 브로드캐스트.
- **턴 제한시간**(2026-08-21~, REQUIREMENTS.md §4.1): 던지기 5초 + 말 선택 5초, 각각 독립적으로 카운트. 시간초과 시 서버가 §5와 동일한 확률 분포로 무작위 던지기 / 완주 안 한 첫 말을 자동 이동시킨다. 연결이 끊긴 플레이어의 턴도 이 타이머 덕분에 최대 10초 안에 자동으로 넘어가므로, **별도의 재접속/이탈 처리 로직이 없다** — 의도된 설계(disconnect 정책을 따로 만들지 않기로 한 결정, 세션 기록 참고).
- `MatchRoom`의 타이머는 songpyeon의 4초 팀 턴 타이머와 동일한 `turnToken` 증가 가드 패턴을 쓴다 — 새 타이머를 걸 때마다 토큰을 증가시키고, 콜백 실행 시 자기 토큰이 아직 최신인지 확인해 오래된 타이머를 조용히 무시한다. 별도의 타이머 취소 호출이 필요 없음.
- **클라이언트 타입은 서버 스키마를 손으로 미러링**한다(`client/src/game/matchTypes.ts`) — client/server가 별도 워크스페이스라 공유 타입 패키지가 없음(songpyeon과 동일 관례). 서버 스키마(`server/src/rooms/MatchState.ts`) 필드를 바꾸면 이 파일도 반드시 같이 고칠 것 — 자동으로 안 맞춰짐.
- 클라이언트 구조: `client/src/game/`(순수 타입/훅/헬퍼: `matchTypes.ts`, `useMatchRoom.ts`, `playerLabel.ts`), `client/src/components/`(화면: `WaitingRoom`, `GameBoard`, `TurnPanel`, `WinnerScreen`) + CSS Modules. `App.tsx`가 `room.state.phase`(`waiting`/`playing`/`finished`)로 화면을 라우팅.
- **보드는 현재 기능 우선(no-polish) 상태**: `GameBoard.tsx`는 전통 윷놀이판 그림이 아니라 외곽 1~19번 칸을 나열한 단순 그리드 + 중앙 칸 + 플레이어별 대기/완주 트레이. 실제 보드 아트 + Matter.js 윷가락 애니메이션은 별도 후속 계획(아직 미작성).
- **캐릭터(교주/성직/마담/의사) 능력 효과는 전부 미구현** — 대기실에서 인당 2종 선택(중복 가능)까지만 있고, 실제 효과는 아직 설계도 안 됨(REQUIREMENTS.md §2, §11).

## 보드 좌표계 — 의도적 단순화 (버그 아님)

`server/src/game/position.ts`의 지름길 모델은 실제 윷놀이판을 그대로 구현한 게 아니라 의도적으로 단순화한 것이다: 5/10/15번 코너 **어디서든** 지름길을 타면 "1칸=중앙, 2칸 이상=바로 완주"로 동일하게 처리한다(실제 게임은 코너마다 지름길 길이가 다름 — 10번 코너가 원래도 가장 강력하고, 5·15번은 상대적으로 약함). 최종 리뷰에서 "게임이 실제보다 스윙성이 크고, 클라이언트가 지름길 중간 칸을 그릴 좌표가 없다"는 지적이 나왔지만, 사용자가 **"지금은 보류, 클라이언트 렌더링 계획 시작 전에 재검토"**로 명시적으로 결정했다. 이 모델을 다시 논의 없이 재설계하지 말 것 — 이미 한 번 물어보고 답이 나온 사안이다. 재검토가 필요해지면 `position.ts` 파일 하나만 고치면 되도록 격리되어 있다.

## Gotchas

- **`@colyseus/core@0.16.25`는 `workspace:^` 퍼블리시 버그로 `npm install`이 깨진다** — 루트 `package.json`의 `overrides: {"@colyseus/core": "0.16.24"}`로 고정해뒀음. colyseus 버전을 올릴 일이 있으면 이 override가 여전히 필요한지(상류 버그가 고쳐졌는지) 먼저 확인할 것. (`docs/TROUBLESHOOTING.md` #1)
- **`server/vitest.config.ts`는 `fileParallelism: false` 필요** — `@colyseus/testing`의 `boot()`가 `Server` 인스턴스를 받으면 포트 인자를 무시하고 항상 고정 포트(2568)에 바인드해서, 룸 통합 테스트 파일이 2개 이상이면 병렬 실행 시 충돌한다. (`docs/TROUBLESHOOTING.md` #2)
- **게이지 판정(`throwStart`/`throwRelease` 타임스탬프)에는 `this.clock.currentTime`이 아니라 반드시 `Date.now()`를 쓸 것** — Colyseus의 내부 시뮬레이션 클록은 `setSimulationInterval`을 안 쓰는 이 방(room)에서는 `broadcastPatch()` 호출 시에만(기본 patchRate=50ms) 갱신되므로, 이 게임의 가장 좁은 게이지 구간("모", 약 46.875ms)보다 해상도가 거칠다. 5초 턴 타이머(`this.clock.setTimeout`)는 이 정밀도가 필요 없어서 그대로 써도 된다 — 이 구분을 헷갈리지 말 것.
- **업기(피기백) 판정은 "도착 칸"이 아니라 "출발 칸" 기준**이다 — `pieces.ts`의 `applyMove`는 이동하는 말의 **이전(출발) 위치**에 같은 주인의 다른 말이 있었는지로 업기를 판정한다. "도착한 칸에 이미 내 말이 있으면 업힌다"는 게 아니라, "이미 업혀 있던(같은 칸에서 출발한) 말들이 함께 이동한다"는 의미다. `samePosition`은 `outer`(같은 index)와 `center`끼리만 "같은 칸"으로 치고 `start`/`finished`는 절대 그렇게 취급하지 않는다 — 이 규칙을 깨면 `docs/TROUBLESHOOTING.md` #3이 재발한다.
- **잡기는 `teamId` 기준, 업기는 `ownerId` 기준** — 둘을 섞으면 안 된다. `Piece.teamId`는 `MatchRoom`이 매 이동마다 `players.get(ownerSessionId).team`을 조회해서 채우는 파생값이라, 연결이 끊긴 플레이어의 말은 팀 정보가 `""`로 빠질 수 있다(알려진 한계, 아래 참고).
- **클라이언트에서 상태가 바뀌는 UI(턴 전환, 게이지 phase 등)를 건드릴 때는 리렌더 트리거를 확인할 것** — `useMatchRoom.ts`는 `room.onStateChange`(영구 리스너) + `forceRender()` 패턴을 쓴다. `.once()`로 되돌리면 즉시 회귀. (`docs/TROUBLESHOOTING.md` #7)
- **`gaugePhase`에 따라 다른 JSX 엘리먼트를 조건부 렌더링하는 패턴을 던지기 버튼에 다시 쓰지 말 것** — `idle`/`charging` 상태를 서로 다른 엘리먼트로 그리면, 리렌더 시 버튼이 언마운트되면서 포인터 캡처가 풀려 `pointerup`(=`throwRelease`)이 안 잡힌다. 반드시 하나의 엘리먼트를 유지하고 라벨/속성만 바꿀 것. (`docs/TROUBLESHOOTING.md` #9 — 이번 프로젝트에서 가장 심각했던 버그)
- **Colyseus `sessionId`는 하이픈(`-`)을 포함할 수 있다** — `pieceId`(`` `${sessionId}-${i}` ``)에서 말 번호를 뽑을 때 `split("-")[1]`을 쓰면 깨진다. 항상 `split("-").pop()`(마지막 조각)을 쓸 것. (`docs/TROUBLESHOOTING.md` #10)
- **알려진 한계, 고치지 않기로 함**: `GameBoard`의 대기/완주 트레이는 `room.state.players`를 순회해서 만들어지므로, 연결이 끊긴 플레이어의 말은 보드 어디에도 안 그려질 수 있다(서버 상태 자체는 정상, 클라이언트 표시만 비는 것). 재접속/이탈 정책을 별도로 만들지 않기로 한 결정과 같은 맥락 — 필요해지면 그때 다시 설계할 것.

## Key docs

- `docs/REQUIREMENTS.md` (v0.3) — 게임 규칙 명세. 1차 소스는 사용자의 직접 설명 + 참고 영상(마피아42 실제 인게임 화면) 확인 결과.
- `docs/ARCHITECTURE.md` — 기술 스택 선택 이유, Colyseus 개념 매핑, 게이지 서버 시간 판정 설계.
- `docs/TROUBLESHOOTING.md` — 실제 발생한 버그의 근본 원인 기록 (위 Gotchas는 요약본, 재현/진단 과정은 원문 참고).
- `docs/superpowers/plans/` — 과거 구현 계획 문서(핵심 게임 엔진, 대기실+기본 플레이 화면). 완료된 기능의 설계 배경을 알고 싶을 때 참고.

## Workflow

- 서버 순수 게임 로직(`server/src/game/*`)은 TDD로 구현되어 왔음 — 새 규칙도 로직 파일과 테스트 파일을 같이 작성.
- 클라이언트는 테스트 프레임워크 없이 `npm run build` + 실제 브라우저 확인으로 검증(위 Commands 참고).
- 구현은 subagent-driven-development(브레인스토밍 → 계획 문서 → 태스크별 서브에이전트 구현+리뷰 → 전체 브랜치 최종 리뷰)로 진행해왔음, `main`에 직접 커밋(songpyeon과 동일 관례, 별도 브랜치/PR 안 씀).
- 커밋 메시지는 한국어로, `feat:`/`fix:` 같은 프리픽스 없이 작성.
- 다음 예정 작업: 게이지 시각 연출(Matter.js 윷가락 애니메이션), 채팅/말풍선 — 둘 다 REQUIREMENTS.md에 명시된 대로 아직 미착수.
