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
- **관전 기능(2026-08-27~)**: 클라이언트는 플레이어든 관전자든 항상 같은 `joinById` 한 종류만 쓴다 — `MatchRoom.onJoin`이 `state.phase`로 알아서 가른다. `phase==="waiting"`이고 `state.players.size < playerCapacity`(2v2=4, 1v1=2, `Colyseus의 maxClients`와는 다른 값)면 플레이어로, 자리가 없으면 입장 자체를 거부(`throw`)한다. 그 외(`playing`/`finished`)에는 `allowSpectators`(방 만들 때 옵션, 기본 허용)가 켜져 있으면 `state.spectators`에 등록, 꺼져 있으면 거부한다. **`this.lock()`을 더 이상 게임 시작 시 부르지 않는다** — Colyseus 소스(`@colyseus/core`의 `MatchMaker.js`)를 직접 확인한 결과, 진짜 `lock()`은 `joinById` 자체를 매치메이커 단계에서 "room is locked"로 거부해버려서 관전자도 못 들어오게 된다. 대신 방 목록 API(`/api/rooms`)가 `matchMaker.query({name:"match"})`(더 이상 `locked:false`로 안 거름)로 모든 방을 가져와 `metadata.phase`가 `"finished"`인 것만 걸러서 응답하고, 클라이언트는 `metadata.phase`/`allowSpectators`/`playerCount`/`playerCapacity`로 "입장"/"관전하기"/"게임 중"/"가득 참" 버튼을 결정한다(`client/src/components/RoomList.tsx`의 `joinButtonState`). 관전자는 `GameBoard`/`PlayerCorner`/`TurnPanel`이 전부 `sessionId === room.sessionId` 비교로만 내 턴/내 말을 판단해서 **추가 컴포넌트 없이 기존 화면 그대로 읽기 전용으로 보인다** — songpyeon과 달리 별도 SpectatorScreen이 필요 없었다. 채팅 말풍선(`ParticipantBar`, `useChatBubbles`)도 세션ID 기반이라 관전자에게 그대로 재사용된다(점선 테두리 아바타로만 구분).
- **나가기 버튼(2026-08-27~)**: `ParticipantBar`에 있다. 플레이어는 대기 중(`phase==="waiting"`)에만 보인다 — 플레이 중엔 필요 없다고 확정됨(사용자 지시). 관전자는 애초에 게임이 시작된 뒤에만 존재해서 이 규칙을 그대로 적용하면 나갈 방법이 없어지므로, 관전자에게는 단계와 무관하게 항상 보여준다. 게임 종료 화면(`WinnerScreen`)은 이미 자체 "로비로 돌아가기" 버튼이 있어 건드리지 않았다.
- **턴 제한시간**(2026-08-21~, REQUIREMENTS.md §4.1): 던지기 5초 + 말 선택 5초, 각각 독립적으로 카운트. 시간초과 시 서버가 §5와 동일한 확률 분포로 무작위 던지기 / 완주 안 한 첫 말을 자동 이동시킨다. 연결이 끊긴 플레이어의 턴도 이 타이머 덕분에 최대 10초 안에 자동으로 넘어가므로, 재접속 유예 중에도 게임이 멈추지 않는다.
- **재접속(2026-08-29~)**: 게임 진행 중(`phase==="playing"`) 갑작스런 연결 끊김(와이파이 끊김, 탭/창 닫힘 등)은 20초 유예를 준다 — `server/src/rooms/MatchRoom.ts`의 `onLeave`가 `!consented && phase==="playing"`일 때만 `this.allowReconnection(client, RECONNECTION_GRACE_SECONDS)`를 호출한다. 대기실 이탈/관전자 이탈/"나가기" 버튼 클릭(consented=true)은 유예 없이 즉시 처리 — 플레이 중엔 애초에 나가기 버튼이 없어서(`ParticipantBar.tsx`) 이 단계의 끊김은 항상 의도치 않은 것이라는 전제로 설계됐다. 재접속은 `onAuth`를 다시 안 타므로 유예 시간 동안 계정이 밴됐을 가능성을 `onLeave`가 재접속 직후 직접 재확인한다. 클라이언트는 `client/src/colyseus.ts`(`saveReconnectInfo`/`loadValidReconnectToken`/`reconnectToRoom`, `localStorage` 키 `"yutnori:reconnect"`, 유예 판단 상수 `RECONNECTION_GRACE_MS`)가 방 입장/재접속 성공마다 최신 토큰을 저장해뒀다가, 마운트 시 유효한 토큰이 있으면 자동 재접속을 시도하고 게임 도중 `room.onLeave`가 발동해도 같은 방식으로 재시도한다(`App.tsx`). 의도적 퇴장("나가기"/"로비로 돌아가기")과 갑작스런 끊김을 구분하기 위해 `room.leave()` 호출은 `App.tsx`의 `handleLeaveLobby` 하나로 중앙화되어 있다(`intentionalLeaveRef`로 표시) — `ParticipantBar.tsx`/`WinnerScreen.tsx`는 더 이상 직접 `room.leave()`를 부르지 않는다. 실제 브라우저 탭을 완전히 닫았다 4초 뒤 다시 연 상태로 Playwright E2E 검증 완료(게임 상태 100% 보존, 유예 중 밀린 턴은 기존 턴 타이머가 정상적으로 자동 진행).
- `MatchRoom`의 타이머는 songpyeon의 4초 팀 턴 타이머와 동일한 `turnToken` 증가 가드 패턴을 쓴다 — 새 타이머를 걸 때마다 토큰을 증가시키고, 콜백 실행 시 자기 토큰이 아직 최신인지 확인해 오래된 타이머를 조용히 무시한다. 별도의 타이머 취소 호출이 필요 없음.
- **클라이언트 타입은 서버 스키마를 손으로 미러링**한다(`client/src/game/matchTypes.ts`) — client/server가 별도 워크스페이스라 공유 타입 패키지가 없음(songpyeon과 동일 관례). 서버 스키마(`server/src/rooms/MatchState.ts`) 필드를 바꾸면 이 파일도 반드시 같이 고칠 것 — 자동으로 안 맞춰짐.
- 클라이언트 구조: `client/src/game/`(순수 타입/훅/헬퍼: `matchTypes.ts`, `useMatchRoom.ts`, `playerLabel.ts`), `client/src/components/`(화면: `WaitingRoom`, `GameBoard`, `TurnPanel`, `WinnerScreen`) + CSS Modules. `App.tsx`가 `room.state.phase`(`waiting`/`playing`/`finished`)로 화면을 라우팅.
- **채팅은 화면 우하단에 항상 떠 있는 채팅창(2026-08-29~, `ChatBox.tsx` + `game/useChatLog.ts`)** — `App.tsx`에서 phase와 무관하게 항상 렌더링되어 대기실/플레이 어디서든 같은 창이 보인다. `useChatLog`이 서버의 `chatMessage` 브로드캐스트를 전부(최대 200개, 넘으면 오래된 것부터 버림) 로컬 배열에 누적할 뿐 서버엔 저장하지 않으므로, 중간 입장한 참가자는 그 이전 채팅을 못 본다 — 이전엔(v0.2~) 세션ID당 메시지 하나만 3초간 들고 있다가 지우는 말풍선(`useChatBubbles.ts`, `ParticipantBar`가 아바타 위에 표시)이었는데 완전히 교체됐다(`useChatBubbles.ts`/`ChatInput.tsx` 삭제됨) — REQUIREMENTS.md §8 참고.
  - **기본은 접힌 상태(2026-08-29 추가)** — 처음엔 항상 펼쳐둔 채로 만들었는데, 모바일 화면에서 항상 펼쳐진 채팅창이 화면 대부분을 가린다는 신고로 헤더만 보이는 접힌 상태를 기본값으로 바꿨다. 헤더(`ChatBox.tsx`의 `<button>`)를 눌러 펼치고 접는다. 접혀 있는 동안 도착한 메시지 수는 헤더의 안읽음 배지로 보여주고, 펼치면 0으로 리셋된다 — `open` 상태를 `openRef`(useRef)로도 미러링해서, 메시지 누적 effect가 `open`을 의존성에 안 넣고도(그러면 매 토글마다 다시 스크롤/카운트 로직이 도는 걸 피할 수 있다) 항상 최신 열림 여부를 읽을 수 있게 했다.
- **보드는 실제 정사각형 트랙 시각화가 구현되어 있다**(2026-08-23~): `GameBoard.tsx`는 SVG로 그린 정사각형 트랙(외곽 20칸 + 5/10/15번 대각선 지름길 + 중앙)을 표시하고, 좌표는 `client/src/game/boardCoords.ts`(`positionToCoords`, `JUNCTION_CORNER`)가 계산한다. 말은 팀 색이 입혀진 캐릭터 초상(`PieceToken`)으로 보드 위에 그려지고, 플레이어 정보는 화면 네 모서리(`PlayerCorner`, `client/src/game/cornerSlots.ts`의 `assignCorners`로 배치 결정)에 카드로 표시된다. 던지기 트리거는 더 이상 전용 버튼이 아니라 보드 전체 영역(`GameBoard.tsx` 루트 `<div>`의 `onPointerDown`/`onPointerUp`)이다. 설계 배경은 `docs/superpowers/specs/2026-08-23-board-visualization-design.md` 참고.
- **캐릭터(교주/성직/마담/의사) 능력 효과는 구현 완료**(2026-08-21~, `server/src/game/abilities.ts`) — 상세 규칙은 `docs/superpowers/specs/2026-08-21-character-abilities-design.md` 참고. 캐릭터 선택 개수는 모드별로 다름(2v2=서로 다른 2종, 1v1=중복 허용 4종, REQUIREMENTS.md §2).
- **구글 로그인 + 관리자 대시보드 + DB** (2026-08-29~): 로그인이 필수가 됐다(익명 플레이 없음) — `better-sqlite3`
  단일 DB 파일(`server/src/db/connection.ts`)에 계정(`users`, 닉네임은 계정당 최초 1회 고정 후 관리자만
  변경 가능)과 로그(`events`=입퇴장, `chat_logs`, `user_ips`, `daily_visit_log`, `inquiries`,
  `nickname_history`)를 저장한다. `MatchRoom.onAuth`가 WS 업그레이드 시점에 세션 쿠키를 직접 파싱해
  로그인/밴 여부를 검증하고(`server/src/auth/session.ts`, `googleAuth.ts`), 통과하면 `client.auth`에
  `{ip, userId, nickname}`을 담아 `onJoin`이 그대로 쓴다 — 더 이상 클라이언트가 보내는 닉네임 문자열을
  신뢰하지 않는다. 관리자 페이지(`/admin`, `ADMIN_PASSWORD` 환경변수, 12시간 세션 + 5회/15분 로그인
  시도 제한)는 songpyeon과 동일 패턴(`server/src/admin/*`, `client/src/components/Admin*.tsx`)이며,
  yutnori에 없는 기능(친구/상점/닉네임효과/특정유저 감시로그/실시간 입력 모니터링)은 옮기지 않았다.
  기존 룸 통합 테스트 4개 파일은 `server/src/testUtils/connectAsUser.ts`(테스트 유저를 DB에 만들고
  세션 쿠키로 직접 WS 연결하는 헬퍼, songpyeon과 동일 패턴)로 전부 이전했다. 같은 계정이 탭/기기
  두 개로 같은 방에 동시에 플레이어로 들어오는 것도 `MatchRoom.ts`의 `playerUserIds`(sessionId ->
  userId 맵)로 막는다 — 두 번째 시도는 "이미 이 방에 참가 중인 계정입니다."로 거부된다(관전자는
  이 체크 대상이 아님). 설계: `docs/superpowers/specs/2026-08-29-google-login-admin-design.md`.

## 보드 좌표계 — 지름길 모델(2026-08-22 재설계)

`server/src/game/position.ts`의 지름길은 더 이상 "1칸=중앙 즉시 도착, 2칸 이상=바로 완주"인 옛 단순 모델이 아니다 — 모서리(5/10/15번)와 중앙 사이에 실제 중간칸이 있는 모델로 재설계했다: `Position`에 `shortcutIn{junction, step:1|2}`(모서리→중앙 구간)과 `shortcutOut{step:1|2}`(중앙→도착 구간)이 추가됐고, 전체 경로를 "모서리=절대값 0, 1~2=shortcutIn, 3=center, 4~5=shortcutOut, 6 이상=finished"인 6칸 트랙 하나로 계산한다(`shortcutPositionFromAbsolute` 헬퍼). 지름길에 한번 올라탄 뒤로는(shortcutIn/center/shortcutOut 어디서든) 선택지 없이 항상 자동 진행한다 — 중앙에서 "어느 방향으로 나갈지" 플레이어가 고르는 로직은 없다(사용자가 명시적으로 확정한 설계); 어느 방향인지는 **진입 모서리가 결정**한다(아래 2026-08-24 재설계 참고 — 더 이상 모든 경로가 "도착 방향"으로 수렴하지 않는다). 상세 설계는 `docs/superpowers/specs/2026-08-22-diagonal-shortcut-model-design.md` 참고.

**5↔15번 실제 교차로 재설계됨(2026-08-24)**: 위 대칭 단순화는 이동 애니메이션이 추가되면서 "5번에서 지름길을 타도 15번이 아니라 출발점 방향으로 꺾인다"는 부자연스러움이 눈에 띄게 드러나 재검토했다. 상세 설계는 `docs/superpowers/specs/2026-08-24-real-diagonal-crossing-design.md` 참고. 핵심 변경:
- **5번**에서 지름길을 타면 실제로 **15번 쪽으로 건너간다** — 중앙을 지나 정확히 6칸째에 외곽 15번 칸(`{kind:"outer", index:15}`)에 착지하고, 그 이후는 평범한 바깥길 이동이다(더 이상 "6칸=완주"가 아님).
- **10번**은 기존과 동일하게 완주 방향을 유지한다 — 원래부터 대각선 파트너가 출발점이라 실제 모델과 결과가 같다. **15번은 처음엔(2026-08-24) 완주 방향 유지로 예외 처리했었지만, 2026-08-27에 지름길 후보에서 아예 제외됐다** — 진짜 교차 모델대로면 5번으로 떨어져 완주에서 크게 손해고, 완주 방향 유지 예외로 남겨둬도 바깥길 그대로(5칸)보다 지름길(6칸)이 오히려 1칸 더 걸려 아무 이득이 없었기 때문. 지금은 15번에 있는 말은 `useShortcut` 값과 무관하게 항상 바깥길 그대로 간다 — `SHORTCUT_JUNCTIONS`/`SHORTCUT_JUNCTION_INDICES`에서 15를 뺐다(`server/src/game/position.ts`, `client/src/game/matchTypes.ts`). **보드 시각화(대각선 선, `shortcutIn15` 중간칸 점)는 5번/10번과 동일하게 그대로 유지한다** — 처음엔 이것도 같이 지웠었는데, 사용자가 "이동 규칙(꺾기)만 막아달라고 했지 보드 판 생김새(칸)를 없애달라고는 안 했다"고 명시적으로 되돌려달라고 해서(2026-08-27) `GameBoard.tsx`의 대각선 목록과 `SHORTCUT_DOTS`에 15를 다시 넣었다. 즉 **로직 차단(이동 계산에서 15는 지름길로 안 꺾임)과 시각적 완전성(보드는 세 대각선 다 그림)을 분리해서 유지**한다 — 앞으로 이 둘을 같이 묶어서 건드리지 말 것.
- `Position` 타입에 `center.exitVia: "finish" | "cross"`(어느 트랙으로 이어갈지 기억)와 `shortcutCross`(5번 교차 전용 구간, `shortcutIn(junction:15,·)`와 물리적으로 같은 칸이지만 진행 방향이 반대라 별도 kind) 두 가지가 추가됐다.
- 재검토가 다시 필요해지면(예: 15번도 진짜 교차로 바꾸고 싶어지면) 이 스펙 문서를 먼저 참고할 것 — "중앙에 멈춰 선 말이 다음에 어느 트랙으로 이어갈지"를 기억하는 `exitVia` 필드 설계가 재사용 가능하다.

**중앙(centerCross)에서만 트랙 전환 허용(2026-08-25)**: 위 44번째 줄의 "선택지 없이 항상 자동 진행한다"는 규칙에 사용자가 명시적으로 요청한 예외가 하나 생겼다 — 5번에서 타서 **정확히 중앙에 멈춰 선 말**(`{kind:"center", exitVia:"cross"}`)이 새 턴에 이어서 움직일 때만, 원래 트랙(15번 방향, `useShortcut:false`)을 계속 타거나 도착 방향 트랙으로 전환(`useShortcut:true`)할 수 있다. `shortcutIn`/`shortcutCross` 같은 지름길 중간 칸이나, 하나의 큰 이동(모=5칸 등)이 중앙을 그냥 지나쳐가는 경우는 여전히 선택지가 없다 — 오직 "중앙에 멈춰 서 있는 상태에서 새로 이동을 시작할 때"만 해당. `server/src/game/position.ts`의 `moveForward`(`from.kind==="center" && from.exitVia==="cross"` 분기), `client/src/game/movePath.ts`/`moveDestinations.ts`가 동일하게 미러링한다.
  - **클라이언트 시각화 버그였던 부분(같은 날 수정)**: `client/src/game/movePath.ts`가 한 번의 연속 이동(예: 5번에서 모=5칸)을 한 칸씩 시뮬레이션할 때, 그 경로가 중간에 정확히 중앙을 "지나치는" 시점에도 위 선택 로직이 잘못 끼어들어 "중앙까지 3칸 + 거기서 꺾어서 2칸"처럼 실제로는 불가능한(트랙을 이동 도중에 바꾸는) 목적지 점을 표시하는 버그가 있었다. 선택은 오직 이동이 **정확히 중앙에서 시작할 때**(`computeMovePath`의 첫 스텝이면서 시작 위치 자체가 centerCross)만 유효하다 — `stepForwardOnce`에 `canChooseAtCenter` 플래그를 추가해 구분한다. 서버(`position.ts`)는 애초에 각 이동을 스텝별 시뮬레이션이 아니라 시작 위치 기준 닫힌 형태 계산으로 처리해 이 버그가 없었다.
  - **교주 보너스도 중앙 정지 시 선택권 필요(같은 날 확장)**: 모서리(5/10/15)에서 교주 보너스가 발동하면 즉시 적용하지 않고 대기 패로 쌓는 기존 규칙(위 §3.1/§4 changelog)이 "본 이동이 정확히 중앙(centerCross)에 멈춰 선 채로 끝난 경우"까지 확장됐다 — 안 그러면 `useShortcut:false`로 못박혀 자동으로 15번 방향(돌아가는 길)으로만 가고 도착 방향을 고를 수 없었다. `MatchRoom.ts`의 `atJunction` 판정에 `atCenterChoice`(`position.kind==="center" && exitVia==="cross"`)를 or 조건으로 추가했다.

## Gotchas

- **`@colyseus/core@0.16.25`는 `workspace:^` 퍼블리시 버그로 `npm install`이 깨진다** — 루트 `package.json`의 `overrides: {"@colyseus/core": "0.16.24"}`로 고정해뒀음. colyseus 버전을 올릴 일이 있으면 이 override가 여전히 필요한지(상류 버그가 고쳐졌는지) 먼저 확인할 것. (`docs/TROUBLESHOOTING.md` #1)
- **`server/vitest.config.ts`는 `fileParallelism: false` 필요** — `@colyseus/testing`의 `boot()`가 `Server` 인스턴스를 받으면 포트 인자를 무시하고 항상 고정 포트(2568)에 바인드해서, 룸 통합 테스트 파일이 2개 이상이면 병렬 실행 시 충돌한다. (`docs/TROUBLESHOOTING.md` #2)
- **턴 남은 시간 표시는 클라이언트-서버 시계 오차를 보정해야 한다(2026-08-30~, songpyeon과 동일 문제/해법)** — `TurnPanel.tsx`가 서버의 절대 시각(`turnDeadlineAt`)에서 그냥 로컬 `Date.now()`를 빼면, 기기 시계가 서버(EC2)와 어긋난 경우(흔함 — 폰은 EC2처럼 NTP로 안 맞춰져 있음) 화면에 뜨는 "남은 시간"이 실제 서버 판정 시점과 어긋난다. 기기 시계가 서버보다 느리면 실제로는 이미 시간초과가 지났는데도 화면엔 아직 여유가 있는 것처럼 보여서 "내 차례인데 던지지도 못하고 넘어갔다"는 체감으로 이어졌다(신고된 버그). `client/src/game/clockSync.ts`의 `estimateClockOffset`(ping/pong 5회 왕복의 중간값)이 방 입장마다 오프셋을 재고(`useMatchRoom.ts`), `TurnPanel.tsx`는 `Date.now() + clockOffsetMs`로 보정한 값을 서버 시각과 비교한다 — 서버는 `onCreate`에 등록된 `ping`/`pong` 에코 핸들러로 응답한다.
- **게이지 판정(`throwStart`/`throwRelease` 타임스탬프)에는 `this.clock.currentTime`이 아니라 반드시 `Date.now()`를 쓸 것** — Colyseus의 내부 시뮬레이션 클록은 `setSimulationInterval`을 안 쓰는 이 방(room)에서는 `broadcastPatch()` 호출 시에만(기본 patchRate=50ms) 갱신되므로, 이 게임의 가장 좁은 게이지 구간("윷"/"모", 각각 약 18.75ms — 왕복 주기 600ms 기준, 2026-08-29에 1000ms→600ms로 단축)보다 해상도가 거칠다. 5초 턴 타이머(`this.clock.setTimeout`)는 이 정밀도가 필요 없어서 그대로 써도 된다 — 이 구분을 헷갈리지 말 것.
- **`previousPosition`은 "이동을 시작하기 전 칸"이 아니라 "착지 1칸 전 칸"을 저장해야 한다(2026-08-28 버그 수정, `server/src/game/pieces.ts`의 `applyMove`)** — 빽도(REQUIREMENTS.md §7 "-1칸")는 항상 정확히 1칸만 되돌아가야 하는데, 이동을 시작하기 전 칸을 그대로 저장해두면 2칸 이상(개/걸/윷/모) 이동한 뒤 빽도를 맞았을 때 그 이동 전체 칸수만큼 뒤로 가버린다(신고된 버그: "빽도가 2칸 간다"). 고친 방식은 `moveForward(fromPosition, steps-1, useShortcut)`로 "착지 딱 1칸 전" 위치를 다시 계산해서 저장하는 것 — 새 역방향 계산 함수를 만들지 않고 이미 지름길/중앙 분기를 다 아는 `moveForward`를 재사용한 게 핵심이다(직접 도착 위치에서 거꾸로 추론하면, "10번 지름길로 온 중앙"과 "15번 지름길로 온 중앙"이 같은 `{kind:"center",exitVia:"finish"}`로 겹쳐 보여서 어느 진입 모서리였는지 알 수 없는 모호함이 생긴다 — 원래 시작 위치+걸음수로 계산하면 이 문제가 아예 생기지 않는다). **알려진 한계**: 이 규칙은 빽도 자체가 적용된 결과에는 적용하지 않는다(steps===-1일 때는 여전히 이동 전 칸을 그대로 저장) — 같은 말이 연속으로 두 번 빽도를 맞는 극히 드문 경우, 두 번째 빽도는 역방향으로 한 칸 더 가는 대신 원래 있던 자리로 되돌아간다(신고되지 않은 훨씬 드문 시나리오라 의도적으로 범위 밖으로 뒀다).
- **도착점(외곽 20번)은 도착만으로는 완주가 아니다(2026-08-28 하우스 룰, REQUIREMENTS.md §6)** — `server/src/game/position.ts`의 `LAST_OUTER_INDEX`가 19에서 20으로 늘어서, 정확히 20번(시작점과 같은 모서리, 물리적으로 동일한 칸)에 도착하면 완주가 아니라 평범한 outer 칸처럼 멈춰 서고, 한 칸이라도 더 나가야(21 이상) 비로소 `finished`가 된다. 20번은 업기/잡기 판정도 다른 outer 칸과 완전히 동일하게 받는다(별도 케이스 없음 — `samePosition`/`sideOf` 등 기존 로직이 index 값만으로 동작하므로 자동으로 그렇게 됨). 이 규칙은 도착점에 이르는 **세 경로 전부**(바깥길 그대로, 5번 지름길이 15번을 거쳐 바깥길에 재합류하는 경로, 10번/15번 지름길이 중앙을 거쳐 `shortcutOut`으로 나오는 경로)에 동일하게 적용된다 — `shortcutPositionFromAbsolute`의 절대값 6이 이제 `finished` 대신 `{kind:"outer", index:20}`을 반환하도록 바꿔서, 두 지름길 트랙과 바깥길이 도착점에서 자연스럽게 하나로 합류한다.
- **게이지는 구간을 맞춰도 무조건 확정이 아니다(2026-08-27~, REQUIREMENTS.md §5, 2026-08-29에 윷/모 확률 60%→50%로 추가 하향)** — `server/src/game/gauge.ts`의 `resolveThrow`가 확인 확률(도/개/걸 70%, 윷/모 50%)에 실패하면 구간 비중대로 완전히 새로 재판정한다. 그래서 room의 `rng`가 `Math.random`인 서버 통합 테스트는 특정 결과를 확정 짓기 위해 타이밍(`flush(ms)`)뿐 아니라 **room 옵션의 `rng`도 함께 고정**해야 한다 — 안 그러면 아주 드물게(도/개/걸 30%, 윷/모 50%의 확률로 재판정, 그중에서도 낮은 확률로) 다른 패가 나와 flaky해진다. 이때 고정값 하나를 고를 때 두 가지 함정이 있다: (1) rng가 0처럼 아주 작으면 "도" 확정 후 빽도 재판정(`rng()<0.25`)까지 항상 통과해버려 "도"를 노려도 매번 "빽도"가 나온다 — do 확인 확률(0.7)보다 작으면서 빽도 확률(0.25)보다는 큰 값(예: 0.3)을 쓸 것. (2) 능력 확률(교주 80%, 마담 60% 등)까지 "항상 실패"시켜야 하는 테스트에서 하나의 flat 값(예: 0.99)을 쓰면, 그 값이 게이지 확인에도 재사용되어 재판정을 유발하고 그 재판정이 우연히 항상 "모"가 되어(마지막 구간 fallback) 의도한 결과를 덮어써버릴 수 있다 — 이런 경우 `sequence(...)`(호출마다 다음 값을 주는 결정적 rng)로 "던지기 확인은 성공시키고 그 이후 능력 판정만 실패시키는" 값 순서를 명시적으로 줘야 한다(`MatchRoom.abilities.test.ts` 참고). 윷/모 확인 확률이 정확히 50%이므로 그 확인용 rng 값에 `0.5`를 그대로 쓰면 안 된다(strict less-than 비교라 `0.5 < 0.5`는 false) — 확실히 확인 성공시키려면 0.5보다 작은 값(예: 0.49)을 쓸 것.
- **업기(피기백) 판정은 "도착 칸"이 아니라 "출발 칸" 기준**이다 — `pieces.ts`의 `applyMove`는 이동하는 말의 **이전(출발) 위치**에 같은 주인의 다른 말이 있었는지로 업기를 판정한다. "도착한 칸에 이미 내 말이 있으면 업힌다"는 게 아니라, "이미 업혀 있던(같은 칸에서 출발한) 말들이 함께 이동한다"는 의미다. `samePosition`은 `outer`(같은 index)/`center`/`shortcutIn`(같은 junction+step)/`shortcutOut`(같은 step)끼리만 "같은 칸"으로 치고 `start`/`finished`는 절대 그렇게 취급하지 않는다 — 이 규칙을 깨면 `docs/TROUBLESHOOTING.md` #3이 재발한다.
- **잡기는 `teamId` 기준, 업기는 `ownerId` 기준** — 둘을 섞으면 안 된다. `Piece.teamId`는 `MatchRoom`이 매 이동마다 `players.get(ownerSessionId).team`을 조회해서 채우는 파생값이라, 연결이 끊긴 플레이어의 말은 팀 정보가 `""`로 빠질 수 있다(알려진 한계, 아래 참고).
- **클라이언트에서 상태가 바뀌는 UI(턴 전환, 게이지 phase 등)를 건드릴 때는 리렌더 트리거를 확인할 것** — `useMatchRoom.ts`는 `room.onStateChange`(영구 리스너) + `forceRender()` 패턴을 쓴다. `.once()`로 되돌리면 즉시 회귀. (`docs/TROUBLESHOOTING.md` #7)
- **포인터 캡처를 쥔 엘리먼트를 `gaugePhase` 전환 중 조건부로 언마운트/교체하지 말 것** — 더 이상 전용 던지기 버튼은 없고, 이제 `GameBoard.tsx`의 루트 `<div>`(보드 전체 영역)가 `onPointerDown`/`onPointerUp`과 `setPointerCapture`를 직접 갖는다. 이 div는 게임 내내 계속 마운트돼 있어야 한다 — `idle`/`charging`/`resolved` 등 `gaugePhase`별로 이 루트를 다른 엘리먼트로 갈아끼우거나, 포인터 핸들러를 (조건부 렌더링되는) 자식 엘리먼트로 옮기면, 리렌더 시 캡처가 풀려 `pointerup`(=`throwRelease`)이 안 잡힌다. 즉 버튼이 사라졌다고 이 제약도 함께 사라진 게 아니라, 지금은 보드 전체가 살아있는 던지기 트리거이므로 오히려 똑같이(혹은 더) 중요하다. (`docs/TROUBLESHOOTING.md` #9 — 이번 프로젝트에서 가장 심각했던 버그)
- **Colyseus `sessionId`는 하이픈(`-`)을 포함할 수 있다** — `pieceId`(`` `${sessionId}-${i}` ``)에서 말 번호를 뽑을 때 `split("-")[1]`을 쓰면 깨진다. 항상 `split("-").pop()`(마지막 조각)을 쓸 것. (`docs/TROUBLESHOOTING.md` #10)
- **좁은 화면(모바일)에서 그리드 열이 여러 행에 걸쳐 공유되면 폭이 의도치 않게 합산된다** — `App.module.css`의 `.playScreen`(`grid-template-areas: "tl . tr" ". board ." "bl . br"`)은 3열 구조라 `topLeft`/`bottomLeft`가 같은 왼쪽 열 트랙을, `topRight`/`bottomRight`가 같은 오른쪽 열 트랙을 공유한다. 데스크톱(`#root` 최대 1126px)에서는 `.board`(`width: min(90vw, 480px)`, 넓은 화면에선 480px로 고정)가 항상 여유 있게 들어가서 문제가 안 드러났지만, 뷰포트가 480px보다 좁아져 90vw가 480px 밑으로 떨어지면 보드가 화면의 대부분을 차지하기 시작하면서 옆 플레이어 코너(`PlayerCorner.module.css`의 `.card { min-width: 90px }`)가 필요로 하는 최소 폭까지 더한 전체 폭이 뷰포트를 넘어버려 레이아웃 전체가 한쪽으로 밀리는 가로 스크롤이 생겼다(2026-08-28 발견, 실기기 아니라도 브라우저 창을 375~390px로 좁히면 재현됨). `@media (max-width: 600px)`에서 `.playScreen`을 grid 대신 `flex-direction: column`으로 바꾸고 각 코너/보드에 `order`를 줘서 세로로 쌓는 방식으로 고쳤다 — 그리드 열 공유 자체를 없애 폭 경쟁이 발생하지 않게 하는 게 핵심이었다(각 코너 카드 폭을 줄이거나 보드를 더 작게 만드는 미봉책이 아니라).
- **`MatchRoom.onAuth`는 WS 업그레이드 요청이라 Express의 `cookie-parser` 미들웨어를 안 거친다** —
  `context.headers?.cookie`를 `getCookieValue()`로 직접 파싱해야 한다(HTTP 라우트의 `req.cookies`와는
  별도 경로). 구현이 다르면 안 맞는 게 아니라, 애초에 같은 파싱 로직을 재사용하지 않으면 세션 검증
  자체가 씹힌다.
- **테스트에서 로그인된 유저로 방에 접속하려면 `@colyseus/testing`의 `connectTo`가 아니라
  `server/src/testUtils/connectAsUser.ts`를 써야 한다** — `connectTo`는 커스텀 헤더(쿠키)를 넘길 방법이
  없어서, 실제 세션 쿠키가 필요한 `onAuth`를 통과시킬 수 없다. `colyseus.js`의 `Client`를 직접
  `{ headers: { Cookie: ... } }`로 생성해서 우회한다.
- **관리자 페이지(`/admin`)와 구글 로그인은 같은 오리진에서만 동작함** — dev 환경(client 5173 / server
  2567)은 서로 다른 오리진이라 쿠키 기반 세션이 안 통한다. 로컬에서 확인하려면 client를 빌드해
  `server/public`에 복사한 뒤 서버가 직접 서빙하는 2567 포트로 접속해야 한다(songpyeon과 동일 문제).
- **서버 환경변수(`GOOGLE_CLIENT_ID`/`SESSION_JWT_SECRET`/`ADMIN_PASSWORD`)는 `server/.env`에서 읽는다**
  (`server/src/index.ts`가 `dotenv/config`로 로드, git에는 `.env.example`만 올라간다). 이 파일이 없거나
  비어있으면 구글 로그인이 즉시 실패한다.
- **`docker build`에 `--build-arg VITE_GOOGLE_CLIENT_ID=...`를 빠뜨리면 구글 로그인이 빈 client_id로
  배포된다** — 서버 쪽 `GOOGLE_CLIENT_ID`(런타임 `-e`, ID 토큰 검증용)와 클라이언트 쪽
  `VITE_GOOGLE_CLIENT_ID`(Vite가 빌드 시점에 번들에 박음)는 완전히 다른 주입 경로다.
- **알려진 한계, 고치지 않기로 함**: 대기 중인 말 표시는 `PlayerCorner`가 `assignCorners`(`client/src/game/cornerSlots.ts`, `room.state.turnOrder` 기반으로 모서리 배치)로 결정된 모서리 카드 안에서 그린다. 연결이 끊긴 플레이어라도 `turnOrder`에 남아 있는 한 모서리 자체는 배정되지만, 그 플레이어의 팀 정보(`players.get(...).team`)가 비어 있으면 말 색상 등 표시가 무너질 수 있다(서버 상태 자체는 정상, 클라이언트 표시만 영향받는 것). 재접속(2026-08-29~)에 성공해도 이 표시 문제 자체는 그대로 남는다(재접속이 고치는 건 세션/게임 상태 연결이지, `team` 파생값이 비었던 시점의 표시 문제가 아님) — 필요해지면 그때 다시 설계할 것.

## 배포

songpyeon과 동일한 방식 — **EC2 단일 인스턴스 + Docker + Caddy 리버스 프록시, nip.io 무료 주소, CI/CD 없이 수동 재배포** — 로 배포되어 있다.

- **루트 `Dockerfile`**: 2단계 빌드. 1단계는 `npm ci` 후 client만 빌드(server는 `tsx`로 TS를 그대로 실행하므로 빌드 불필요, `server/package.json`의 `start` 스크립트가 이미 `tsx src/index.ts`). 2단계는 server 소스 + node_modules + client 빌드 결과(`client/dist` → `server/public`)만 담은 런타임 이미지.
- **`server/src/createServer.ts`가 프로덕션에서 client 정적 파일도 서빙**한다 — `server/public/index.html`이 존재할 때만(개발 중엔 없음, 그때는 Vite가 5173에서 따로 서빙) `express.static` + SPA catch-all(`app.get("*", ...)`)을 등록한다. `/api/rooms`보다 뒤에 등록해야 그 라우트를 안 가린다. Colyseus의 웹소켓 업그레이드는 Express 라우팅이 아니라 httpServer의 `upgrade` 이벤트에서 직접 처리되므로 이 catch-all과 충돌하지 않는다.
- **`client/src/colyseus.ts`의 `wsUrl`은 프로덕션에서 같은 origin으로 접속**한다(`${protocol}://${location.host}`) — nip.io 주소는 EC2를 재시작할 때마다 바뀌므로(아래 참고), 빌드에 고정 주소를 박아넣으면 재시작마다 재빌드가 필요해진다. `VITE_COLYSEUS_URL` env는 개발 중 client(5173)/server(2567)를 분리해서 띄울 때만 필요. **주의**: 이 값은 `??`가 아니라 `||`로 폴백해야 한다 — Docker `ARG`를 안 넘기면 `""`(빈 문자열, undefined 아님)로 정의되어 `??`로는 안 걸러진다(실제로 이 버그로 `new Client("")`가 "Invalid URL" 에러를 던지는 걸 로컬 브라우저 테스트에서 잡았다).

**첫 배포 완료(2026-08-27), 인프라 세팅:**
- EC2: Amazon Linux 2023, 서울 리전(ap-northeast-2), 키페어 `yutnori.pem`(워크스페이스 루트, songpyeon.pem과 동일한 위치 관례). 보안 그룹은 songpyeon 것을 그대로 재사용(SSH 22/내 IP, HTTP 80/Anywhere, HTTPS 443/Anywhere — 앱마다 다를 이유가 없는 범용 규칙이라 공유해도 무방).
- 도커 네트워크 `yutnori-net` 하나에 `caddy`(공식 `caddy:2` 이미지, `-p 80:80 -p 443:443`, Caddyfile을 `/home/ec2-user/caddy/Caddyfile`에서 바인드 마운트)와 `yutnori`(우리 앱, 호스트 포트 노출 없이 캐디가 내부 네트워크로만 접근) 두 컨테이너가 떠 있다. 둘 다 `--restart unless-stopped`.
- Caddyfile: `<현재 EC2 IP를 하이픈으로 바꾼 값>.nip.io { reverse_proxy yutnori:2567 }` — Caddy가 컨테이너 이름 `yutnori`를 도커 내장 DNS(127.0.0.11)로 해석해서 프록시한다.

**재배포 절차(2026-08-29 구글 로그인 도입 이후 갱신 — `--build-arg`와 `-e`/`-v`가 추가됨):**
```
# 로컬(워크스페이스 루트)
docker build --build-arg VITE_GOOGLE_CLIENT_ID=<client/.env.local의 값> -t yutnori:latest .
docker save yutnori:latest | gzip > yutnori.tar.gz
scp -i yutnori.pem yutnori.tar.gz ec2-user@43-201-71-99.nip.io:~/

# 서버(SSH, ec2-user@43-201-71-99.nip.io)
docker load < ~/yutnori.tar.gz && rm ~/yutnori.tar.gz
docker stop yutnori && docker rm yutnori
docker run -d --name yutnori --network yutnori-net --restart unless-stopped \
  -e GOOGLE_CLIENT_ID=<client_id> -e SESSION_JWT_SECRET=<값> -e ADMIN_PASSWORD=<값> \
  -v /home/ec2-user/yutnori-data:/app/server/data \
  yutnori:latest
```
`caddy`/`yutnori-net`은 그대로 두고 앱 컨테이너만 교체한다. 이미지 레지스트리 없이 `docker save`→`scp`→`docker load`로 직접 옮기는 것도 songpyeon과 동일. **`--build-arg`를 빠뜨리면 구글 로그인이 빈 client_id로 배포된다**(songpyeon과 동일 함정, `docs/TROUBLESHOOTING.md` 참고 대상) — 재배포 전 `docker run --rm --entrypoint sh yutnori:latest -c "grep -o '<client_id 앞부분>[a-zA-Z0-9._-]*' server/public/assets/*.js"`로 번들에 실제 값이 박혔는지 먼저 확인할 것. `-v`는 반드시 호스트 경로 바인드 마운트여야 한다(네임드 볼륨과 혼동하면 재배포마다 빈 DB로 시작 — songpyeon의 동일 실수 사례가 그쪽 CLAUDE.md에 있음). `GOOGLE_CLIENT_ID`/`SESSION_JWT_SECRET`/`ADMIN_PASSWORD` 실제 값은 로컬 `server/.env`(git 미포함)에서 확인.
관리자 페이지(`/admin`, `/api/admin/*`)는 Caddyfile에 IP allowlist가 추가돼 있다(관리자 PC의 고정 IP만 허용, songpyeon과 동일 `handle`/`handle` 패턴) — 집 인터넷 IP가 바뀌면 여기서 403이 뜬다, `/home/ec2-user/caddy/Caddyfile`의 `remote_ip` 목록을 갱신하고 `docker restart caddy`.

**EC2 재시작 시 반드시 해야 할 일(songpyeon과 동일한 함정)**: EC2를 재시작(중지→시작)하면 **퍼블릭 IP가 바뀐다** — nip.io는 IP를 그대로 호스트명에 박아 쓰므로 주소 전체(`https://<IP>.nip.io`)가 바뀐다. 재시작 후에는 `/home/ec2-user/caddy/Caddyfile`의 호스트명을 새 IP로 고쳐 쓰고 `docker restart caddy`를 해줘야 새 IP용 인증서를 다시 발급받는다 — 안 하면 컨테이너는 다 떠 있어도 새 주소가 아무 응답도 안 한다.

**주소는 EC2 상태에 따라 바뀔 수 있으니, 아래 값을 최신으로 믿지 말고 항상 접속 확인부터 할 것.**

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
- REQUIREMENTS.md 범위 내 기능(서버 엔진, 대기실/플레이 UI, 게이지·Matter.js 던지기 연출, 채팅/말풍선, 캐릭터 능력, 1v1 모드, 지름길 정확 모델 — 5↔15번 실제 교차, 실제 윷판 모양 시각화, 말 이동 애니메이션)과 배포(2026-08-27, EC2+Docker+Caddy)까지 전부 완료. 15번 모서리는 진짜 교차를 적용하면 완주에서 오히려 크게 손해라 지름길 후보에서 아예 제외했다(2026-08-27) — 위 "보드 좌표계" 절 참고, 이미 사용자와 함께 결정 끝난 사안.
