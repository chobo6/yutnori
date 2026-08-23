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
- Colyseus 개념 매핑: Room = 한 경기, 모드(`MatchState.mode`)에 따라 2v2(팀당 2인, 총 4인, 인당 말 2개) 또는 1v1(팀당 1인, 총 2인, 인당 말 4개) — 대기실에서 명시적으로 선택(2026-08-22~, REQUIREMENTS.md §1). Message client→server = `pickMode`/`pickTeam`/`pickCharacters`/`ready`(대기실), `throwStart`/`throwRelease`/`movePiece`(플레이). server→client는 state 변경분 자동 브로드캐스트.
- **턴 제한시간**(2026-08-21~, REQUIREMENTS.md §4.1): 던지기 5초 + 말 선택 5초, 각각 독립적으로 카운트. 시간초과 시 서버가 §5와 동일한 확률 분포로 무작위 던지기 / 완주 안 한 첫 말을 자동 이동시킨다. 연결이 끊긴 플레이어의 턴도 이 타이머 덕분에 최대 10초 안에 자동으로 넘어가므로, **별도의 재접속/이탈 처리 로직이 없다** — 의도된 설계(disconnect 정책을 따로 만들지 않기로 한 결정, 세션 기록 참고).
- `MatchRoom`의 타이머는 songpyeon의 4초 팀 턴 타이머와 동일한 `turnToken` 증가 가드 패턴을 쓴다 — 새 타이머를 걸 때마다 토큰을 증가시키고, 콜백 실행 시 자기 토큰이 아직 최신인지 확인해 오래된 타이머를 조용히 무시한다. 별도의 타이머 취소 호출이 필요 없음.
- **클라이언트 타입은 서버 스키마를 손으로 미러링**한다(`client/src/game/matchTypes.ts`) — client/server가 별도 워크스페이스라 공유 타입 패키지가 없음(songpyeon과 동일 관례). 서버 스키마(`server/src/rooms/MatchState.ts`) 필드를 바꾸면 이 파일도 반드시 같이 고칠 것 — 자동으로 안 맞춰짐.
- 클라이언트 구조: `client/src/game/`(순수 타입/훅/헬퍼: `matchTypes.ts`, `useMatchRoom.ts`, `playerLabel.ts`), `client/src/components/`(화면: `WaitingRoom`, `GameBoard`, `TurnPanel`, `WinnerScreen`) + CSS Modules. `App.tsx`가 `room.state.phase`(`waiting`/`playing`/`finished`)로 화면을 라우팅.
- **보드는 실제 정사각형 트랙 시각화가 구현되어 있다**(2026-08-23~): `GameBoard.tsx`는 SVG로 그린 정사각형 트랙(외곽 20칸 + 5/10/15번 대각선 지름길 + 중앙)을 표시하고, 좌표는 `client/src/game/boardCoords.ts`(`positionToCoords`, `JUNCTION_CORNER`)가 계산한다. 말은 팀 색이 입혀진 캐릭터 초상(`PieceToken`)으로 보드 위에 그려지고, 플레이어 정보는 화면 네 모서리(`PlayerCorner`, `client/src/game/cornerSlots.ts`의 `assignCorners`로 배치 결정)에 카드로 표시된다. 던지기 트리거는 더 이상 전용 버튼이 아니라 보드 전체 영역(`GameBoard.tsx` 루트 `<div>`의 `onPointerDown`/`onPointerUp`)이다. 설계 배경은 `docs/superpowers/specs/2026-08-23-board-visualization-design.md` 참고.
- **캐릭터(교주/성직/마담/의사) 능력 효과는 구현 완료**(2026-08-21~, `server/src/game/abilities.ts`) — 상세 규칙은 `docs/superpowers/specs/2026-08-21-character-abilities-design.md` 참고. 캐릭터 선택 개수는 모드별로 다름(2v2=서로 다른 2종, 1v1=중복 허용 4종, REQUIREMENTS.md §2).

## 보드 좌표계 — 지름길 모델(2026-08-22 재설계)

`server/src/game/position.ts`의 지름길은 더 이상 "1칸=중앙 즉시 도착, 2칸 이상=바로 완주"인 옛 단순 모델이 아니다 — 모서리(5/10/15번)와 중앙 사이에 실제 중간칸이 있는 모델로 재설계했다: `Position`에 `shortcutIn{junction, step:1|2}`(모서리→중앙 구간)과 `shortcutOut{step:1|2}`(중앙→도착 구간)이 추가됐고, 전체 경로를 "모서리=절대값 0, 1~2=shortcutIn, 3=center, 4~5=shortcutOut, 6 이상=finished"인 6칸 트랙 하나로 계산한다(`shortcutPositionFromAbsolute` 헬퍼). 지름길에 한번 올라탄 뒤로는(shortcutIn/center/shortcutOut 어디서든) 선택지 없이 항상 도착 방향으로만 자동 진행한다 — 중앙에서 "어느 방향으로 나갈지" 고르는 로직은 없다(사용자가 명시적으로 확정한 설계). 상세 설계는 `docs/superpowers/specs/2026-08-22-diagonal-shortcut-model-design.md` 참고.

**밸런스 관련, 결정됨(다시 논의 없이 재설계하지 말 것)**: 이 모델은 4개 모서리(5/10/15/출발점)가 전부 대칭(어디서 타든 중앙까지 3칸, 중앙에서 도착까지 3칸)이라고 가정한다 — 실제 윷판은 대각선이 5↔15, 10↔출발점의 두 비대칭 쌍으로 교차하는 구조라 이것과는 다르다. 이 대칭 단순화의 결과로 **15번 모서리에서 지름길을 타면(6칸 소요) 그냥 바깥길로 완주하는 것(15+5=20, 5칸)보다 오히려 손해**다 — 옛 모델에서 15번이 가장 강력한 지름길이었던 것과 정반대로 뒤집혔다. 최종 리뷰에서 지적됐고, 사용자에게 확인한 결과 **"지금은 그대로 두고, 실제 플레이테스트로 진짜 문제가 되면 그때 재검토"**로 결정했다(기존 보드 토폴로지 단순화 결정과 같은 패턴). 재검토가 필요해지면 5↔15, 10↔출발점 두 비대칭 대각선 쌍으로 다시 설계해야 한다.

## Gotchas

- **`@colyseus/core@0.16.25`는 `workspace:^` 퍼블리시 버그로 `npm install`이 깨진다** — 루트 `package.json`의 `overrides: {"@colyseus/core": "0.16.24"}`로 고정해뒀음. colyseus 버전을 올릴 일이 있으면 이 override가 여전히 필요한지(상류 버그가 고쳐졌는지) 먼저 확인할 것. (`docs/TROUBLESHOOTING.md` #1)
- **`server/vitest.config.ts`는 `fileParallelism: false` 필요** — `@colyseus/testing`의 `boot()`가 `Server` 인스턴스를 받으면 포트 인자를 무시하고 항상 고정 포트(2568)에 바인드해서, 룸 통합 테스트 파일이 2개 이상이면 병렬 실행 시 충돌한다. (`docs/TROUBLESHOOTING.md` #2)
- **게이지 판정(`throwStart`/`throwRelease` 타임스탬프)에는 `this.clock.currentTime`이 아니라 반드시 `Date.now()`를 쓸 것** — Colyseus의 내부 시뮬레이션 클록은 `setSimulationInterval`을 안 쓰는 이 방(room)에서는 `broadcastPatch()` 호출 시에만(기본 patchRate=50ms) 갱신되므로, 이 게임의 가장 좁은 게이지 구간("모", 약 46.875ms)보다 해상도가 거칠다. 5초 턴 타이머(`this.clock.setTimeout`)는 이 정밀도가 필요 없어서 그대로 써도 된다 — 이 구분을 헷갈리지 말 것.
- **업기(피기백) 판정은 "도착 칸"이 아니라 "출발 칸" 기준**이다 — `pieces.ts`의 `applyMove`는 이동하는 말의 **이전(출발) 위치**에 같은 주인의 다른 말이 있었는지로 업기를 판정한다. "도착한 칸에 이미 내 말이 있으면 업힌다"는 게 아니라, "이미 업혀 있던(같은 칸에서 출발한) 말들이 함께 이동한다"는 의미다. `samePosition`은 `outer`(같은 index)/`center`/`shortcutIn`(같은 junction+step)/`shortcutOut`(같은 step)끼리만 "같은 칸"으로 치고 `start`/`finished`는 절대 그렇게 취급하지 않는다 — 이 규칙을 깨면 `docs/TROUBLESHOOTING.md` #3이 재발한다.
- **잡기는 `teamId` 기준, 업기는 `ownerId` 기준** — 둘을 섞으면 안 된다. `Piece.teamId`는 `MatchRoom`이 매 이동마다 `players.get(ownerSessionId).team`을 조회해서 채우는 파생값이라, 연결이 끊긴 플레이어의 말은 팀 정보가 `""`로 빠질 수 있다(알려진 한계, 아래 참고).
- **클라이언트에서 상태가 바뀌는 UI(턴 전환, 게이지 phase 등)를 건드릴 때는 리렌더 트리거를 확인할 것** — `useMatchRoom.ts`는 `room.onStateChange`(영구 리스너) + `forceRender()` 패턴을 쓴다. `.once()`로 되돌리면 즉시 회귀. (`docs/TROUBLESHOOTING.md` #7)
- **포인터 캡처를 쥔 엘리먼트를 `gaugePhase` 전환 중 조건부로 언마운트/교체하지 말 것** — 더 이상 전용 던지기 버튼은 없고, 이제 `GameBoard.tsx`의 루트 `<div>`(보드 전체 영역)가 `onPointerDown`/`onPointerUp`과 `setPointerCapture`를 직접 갖는다. 이 div는 게임 내내 계속 마운트돼 있어야 한다 — `idle`/`charging`/`resolved` 등 `gaugePhase`별로 이 루트를 다른 엘리먼트로 갈아끼우거나, 포인터 핸들러를 (조건부 렌더링되는) 자식 엘리먼트로 옮기면, 리렌더 시 캡처가 풀려 `pointerup`(=`throwRelease`)이 안 잡힌다. 즉 버튼이 사라졌다고 이 제약도 함께 사라진 게 아니라, 지금은 보드 전체가 살아있는 던지기 트리거이므로 오히려 똑같이(혹은 더) 중요하다. (`docs/TROUBLESHOOTING.md` #9 — 이번 프로젝트에서 가장 심각했던 버그)
- **Colyseus `sessionId`는 하이픈(`-`)을 포함할 수 있다** — `pieceId`(`` `${sessionId}-${i}` ``)에서 말 번호를 뽑을 때 `split("-")[1]`을 쓰면 깨진다. 항상 `split("-").pop()`(마지막 조각)을 쓸 것. (`docs/TROUBLESHOOTING.md` #10)
- **알려진 한계, 고치지 않기로 함**: 대기 중인 말 표시는 `PlayerCorner`가 `assignCorners`(`client/src/game/cornerSlots.ts`, `room.state.turnOrder` 기반으로 모서리 배치)로 결정된 모서리 카드 안에서 그린다. 연결이 끊긴 플레이어라도 `turnOrder`에 남아 있는 한 모서리 자체는 배정되지만, 그 플레이어의 팀 정보(`players.get(...).team`)가 비어 있으면 말 색상 등 표시가 무너질 수 있다(서버 상태 자체는 정상, 클라이언트 표시만 영향받는 것). 재접속/이탈 정책을 별도로 만들지 않기로 한 결정과 같은 맥락 — 필요해지면 그때 다시 설계할 것.

## Key docs

- `docs/REQUIREMENTS.md` (v0.5) — 게임 규칙 명세. 1차 소스는 사용자의 직접 설명 + 참고 영상(마피아42 실제 인게임 화면) 확인 결과.
- `docs/ARCHITECTURE.md` — 기술 스택 선택 이유, Colyseus 개념 매핑, 게이지 서버 시간 판정 설계.
- `docs/TROUBLESHOOTING.md` — 실제 발생한 버그의 근본 원인 기록 (위 Gotchas는 요약본, 재현/진단 과정은 원문 참고).
- `docs/superpowers/plans/` — 과거 구현 계획 문서(핵심 게임 엔진, 대기실+기본 플레이 화면). 완료된 기능의 설계 배경을 알고 싶을 때 참고.

## Workflow

- 서버 순수 게임 로직(`server/src/game/*`)은 TDD로 구현되어 왔음 — 새 규칙도 로직 파일과 테스트 파일을 같이 작성.
- 클라이언트는 테스트 프레임워크 없이 `npm run build` + 실제 브라우저 확인으로 검증(위 Commands 참고).
- 구현은 subagent-driven-development(브레인스토밍 → 계획 문서 → 태스크별 서브에이전트 구현+리뷰 → 전체 브랜치 최종 리뷰)로 진행해왔음, `main`에 직접 커밋(songpyeon과 동일 관례, 별도 브랜치/PR 안 씀).
- 커밋 메시지는 한국어로, `feat:`/`fix:` 같은 프리픽스 없이 작성.
- REQUIREMENTS.md 범위 내 기능(서버 엔진, 대기실/플레이 UI, 게이지·Matter.js 던지기 연출, 채팅/말풍선, 캐릭터 능력, 1v1 모드, 지름길 정확 모델, 실제 윷판 모양 시각화)은 전부 구현 완료. 남은 후보는 배포 방식 결정(REQUIREMENTS.md §11) 정도. 15번 모서리 지름길 밸런스 역전은 위 "보드 좌표계" 절 참고 — 이미 결정 끝난 사안(그대로 유지, 재검토는 실제 플레이테스트 문제 생기면).
