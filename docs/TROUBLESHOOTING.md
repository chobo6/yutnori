# 트러블슈팅 기록

> 개발 중 발생한 주요 버그와 해결 과정을 기록한 문서입니다.

---

## #1 `npm install`이 `EUNSUPPORTEDPROTOCOL: workspace:^`로 실패

### 증상

모노레포 스캐폴딩 직후 루트에서 `npm install`을 돌리면:
```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:^
```

### 원인 분석

`server/package.json`의 `"colyseus": "^0.16.0"`이 peer dependency로 `@colyseus/core`(0.16.x 최신)를 끌어오는데, 그 시점의 최신 패치인 `@colyseus/core@0.16.25`의 `package.json`에 `"@colyseus/greeting-banner": "workspace:^"`가 그대로 박혀 있었음 — 퍼블리시 시 workspace 프로토콜을 실제 버전으로 치환하지 않은 라이브러리 쪽 배포 버그. `npm view @colyseus/core@0.16.25 dependencies`로 직접 확인. 바로 이전 패치인 `0.16.24`는 `"@colyseus/greeting-banner": "^2.0.6"`으로 정상.

### 해결

루트 `package.json`에 npm `overrides`로 고정:
```json
"overrides": {
  "@colyseus/core": "0.16.24"
}
```
npm workspaces에서 `overrides`는 **루트** package.json에 있어야 client/server 양쪽에 적용됨 (server/package.json에 넣으면 안 먹음).

### 관련 파일
- `package.json` (루트)

---

## #2 `npm test`(server)가 두 번째 통합 테스트 파일부터 `EADDRINUSE :::2568`로 실패

### 증상

`MatchRoom.test.ts`에 이어 `MatchRoom.fullGame.test.ts`를 추가하고 `npm test`(전체 스위트)를 돌리면 간헐적으로:
```
Error: listen EADDRINUSE: address already in use :::2568
```

### 원인 분석

`@colyseus/testing`의 `boot(config)`는 `config`로 `colyseus.Server` 인스턴스가 넘어오면(이 프로젝트의 `createGameServer()`가 그렇게 반환함) **`port` 인자를 무시하고 항상 고정 테스트 포트 2568에 바인드**한다(`node_modules/@colyseus/testing/build/index.mjs`에서 직접 확인). `MatchRoom.test.ts`와 `MatchRoom.fullGame.test.ts` 둘 다 `boot(createGameServer())`를 호출하는데, vitest는 기본적으로 테스트 파일을 여러 프로세스(`pool: "forks"`)로 병렬 실행하므로 두 파일이 동시에 같은 포트를 열려고 경합함.

### 해결

`server/vitest.config.ts`에 `fileParallelism: false` 추가 — 파일 단위로는 순차 실행하도록 강제(파일 내부 테스트 동시성에는 영향 없음). `@colyseus/testing`이 포트 인자를 받아주지 않아서 파일별로 다른 포트를 주는 우회는 불가능했음.

### 관련 파일
- `server/vitest.config.ts`

---

## #3 업기(피기백)가 아직 출발 안 한 말들까지 같이 끌고 나감

### 증상

`pieces.ts`의 `applyMove` 통합 테스트를 새로 짜서(같은 주인의 말 2개가 전부 `{kind:"start"}`인 상태에서 하나만 이동) 돌려보면, 이동시키지 않은 나머지 말까지 같이 이동해버림.

### 원인 분석

`samePosition(a, b)` 함수가 `"outer"`가 아닌 kind끼리는 무조건 `true`를 반환하도록 짜여 있었음:
```ts
function samePosition(a: Position, b: Position): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  return true; // start/start, finished/finished도 전부 true!
}
```
`"start"`(출발 전)는 실제 보드 위 좌표가 아니라 "말이 아직 없다"는 상태일 뿐인데, 이 함수는 그것도 하나의 "같은 칸"으로 취급했음. 결과적으로 같은 주인의 말이 둘 다 `start`에 있을 때(게임 시작 직후가 항상 이 상태), 하나를 움직이면 업기 로직이 "같은 칸에 있던 같은 주인의 말"로 오판해 나머지도 같이 끌고 감. `"center"`는 실제 단일 좌표라 업기가 의미 있지만, `"start"`/`"finished"`는 그렇지 않음.

### 해결

```ts
function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
  return false; // start/finished는 절대 "같은 칸" 취급 안 함
}
```

### 관련 파일
- `server/src/game/pieces.ts`
- `server/src/game/pieces.test.ts` (start 상태 회귀 테스트 추가)

---

## #4 같은 팀 동료의 말이 "상대 말"로 오인되어 잡힘 (아군 오사)

### 증상

전체 브랜치 최종 리뷰에서: 같은 팀 두 플레이어의 말이 같은 칸에 도착하면, 나중에 도착한 말이 먼저 있던 **동료**의 말을 시작점으로 돌려보내버림.

### 원인 분석

`pieces.ts`의 잡기 판정이 애초에 `p.ownerId !== mover.ownerId`(주인이 다르면 잡기)로 짜여 있었고, `Piece` 타입 자체에 팀 개념이 아예 없었음. "상대 팀"과 "다른 사람"을 같은 것으로 취급한 설계 결함 — 계획(plan) 문서 자체에 팀 필드가 빠져 있었던 것이 근본 원인.

### 해결

`Piece`에 `teamId: string` 필드 추가, `MatchRoom.ts`가 `PieceSchema` → `Piece` 변환 시 `players.get(ownerSessionId).team`을 조회해 채움. 잡기 판정을 `p.teamId !== mover.teamId`로 변경(업기 판정은 기존대로 `ownerId` 기준 유지 — REQUIREMENTS.md §6이 업기는 "자신의 말 2개끼리"로 명시).

### 관련 파일
- `server/src/game/pieces.ts`
- `server/src/rooms/MatchRoom.ts` (`toGamePieces()`)
- `server/src/game/pieces.test.ts`, `server/src/game/turns.test.ts` (teamId 필드 추가)

---

## #5 클라이언트가 보낸 값 하나로 서버 프로세스 전체가 죽을 수 있었음

### 증상

전체 브랜치 최종 리뷰에서: `movePiece`로 이미 완주한 말을 지정하거나, `pickTeam`을 payload 없이 보내면 `MatchRoom`의 핸들러 내부에서 예외가 발생하는데, 이게 Colyseus에 의해 잡히지 않고 그대로 새어나갈 수 있었음.

### 원인 분석

Colyseus는 `onMessage` 핸들러를 자동으로 try/catch하지 않는다 — 룸이 `onUncaughtException(err, methodName)` 메서드를 정의하고 있을 때만 `@colyseus/core`가 각 핸들러를 `wrapTryCatch`로 감싼다(`node_modules/@colyseus/core/build/Room.js` 확인). 이 프로젝트의 `MatchRoom`은 그 메서드가 없었음. 또한 `handleMovePiece`(현 `performMove`)가 이미 완주한(`positionKind === "finished"`) 말을 그대로 `applyMove`에 넘기면, `position.ts`의 `moveForward`가 `"이미 완주한 말은 이동할 수 없습니다"`를 던지는데 이게 정상적인 클릭 시퀀스(완주 직전 상태 UI가 아직 안 갱신된 순간의 재클릭 등)로도 실제 도달 가능했음.

### 해결

1. `MatchRoom`에 `onUncaughtException(err, methodName)` 추가(로깅만 하고 예외를 삼킴) — 이 메서드가 존재하는 것 자체가 모든 `onMessage` 핸들러를 try/catch로 감싸는 스위치 역할을 한다.
2. 모든 핸들러 payload에 방어적 가드 추가(`message?.team`, `Array.isArray(message?.characters)`, `typeof message?.pieceId === "string"`).
3. `handleMovePiece`(현 `performMove`)에 `positionKind === "finished"`면 즉시 반환하는 가드 추가 — `applyMove` 호출 전에 막아서 애초에 예외 경로에 안 들어가게 함.

### 관련 파일
- `server/src/rooms/MatchRoom.ts`
- `server/src/rooms/MatchRoom.test.ts` (예외 방어 회귀 테스트, `payload가 없거나 형식이 잘못된 메시지` 테스트)

---

## #6 빽도로 이미 완주한 말이 다시 보드로 돌아옴

### 증상

최종 리뷰에서: `moveForward`는 `{kind:"finished"}`에 대해 에러를 던지도록 되어 있는데, `moveBackward`(빽도)는 같은 가드가 없어서 완주한 말에 빽도를 적용하면 그대로 이전 위치로 되돌아감.

### 원인 분석

`moveForward`/`moveBackward`를 따로 구현하면서 "완주한 말은 못 움직인다"는 불변조건을 `moveForward` 한쪽에만 넣고 `moveBackward`에는 빠뜨림. (`server/src/rooms/MatchRoom.ts`의 `finished` 가드 덕분에 실제 룸에서는 도달 불가능해졌지만, `position.ts` 자체는 이 불변조건을 스스로 지켜야 하는 순수 함수 계층이라 별개로 고쳐야 했음.)

### 해결

`moveForward`와 동일한 가드를 `moveBackward` 맨 앞에 추가.

### 관련 파일
- `server/src/game/position.ts`
- `server/src/game/position.test.ts`

---

## #7 턴이 바뀌거나 말이 움직여도 화면이 안 바뀜 (클라이언트)

### 증상

첫 상태 동기화 직후에는 화면이 뜨는데, 그 이후 다른 플레이어가 턴을 진행하거나 말을 움직여도 내 화면은 그대로 멈춰 있음.

### 원인 분석

스캐폴딩 단계의 `useMatchRoom.ts`가 `joinedRoom.onStateChange.once(() => {...})`를 쓰고 있었음 — `.once()`는 정확히 한 번만 실행되는 리스너라, 최초 상태 동기화 이후에는 서버가 아무리 상태를 바꿔서 브로드캐스트해도 이 콜백이 다시 안 불림. React 쪽에서 리렌더를 트리거할 방법이 아예 없었던 것.

### 해결

`.once()` 대신 영구 리스너 `room.onStateChange(callback)`을 등록하고, 최초 1회는 `status`를 `"connected"`로 바꾸는 데 쓰고 이후 매번은 `useReducer`로 만든 `forceRender()`를 호출해 강제 리렌더(songpyeon 프로젝트의 검증된 패턴을 그대로 재사용).

### 관련 파일
- `client/src/game/useMatchRoom.ts`

---

## #8 (위 #7 수정 직후 발견) 컴포넌트가 언마운트돼도 상태 변경 리스너가 안 떨어짐

### 증상

Task 리뷰에서: `useMatchRoom.ts`의 `useEffect` cleanup이 `disposed = true`만 설정할 뿐, 실제로 `room.onStateChange`에 등록한 콜백을 해제하지 않음. 콜백 내부에서도 `disposed`를 확인하지 않음.

### 원인 분석

`disposed` 플래그를 세팅하는 것과 그 플래그를 실제로 "읽는" 지점이 따로 존재해야 하는데, 콜백 내부(리스너가 실제로 실행되는 곳)에는 그 체크가 빠져 있었고, `Room.onStateChange`가 노출하는 `.remove(callback)` 메서드도 호출되지 않았음. 지금은 `App.tsx`가 이 훅을 루트에서 한 번만 마운트하고 언마운트하는 경로가 없어 실질적 영향은 없지만, 나중에 라우팅이 생기면 방을 나간 뒤에도 죽은 컴포넌트가 계속 `setState`를 시도하는 누수가 됨.

### 해결

콜백을 이름 있는 함수로 분리해 맨 앞에 `if (disposed) return;`을 추가하고, effect 스코프 변수에 join된 room과 그 콜백 참조를 저장해뒀다가 cleanup에서 `joinedRoom.onStateChange.remove(handleStateChange)`를 호출.

### 관련 파일
- `client/src/game/useMatchRoom.ts`

---

## #9 던지기 버튼을 누르고 있다가 떼도 대부분 실제 결과가 아니라 서버의 5초 자동 던지기로 대체됨 (가장 심각했던 버그)

### 증상

전체 브랜치 최종 리뷰(실제로 브라우저를 띄워서 확인)에서: 던지기 버튼을 눌렀다 뗐는데 결과가 즉시 안 나오고, "누르고 있는 중..." 문구가 한동안 유지되다가 몇 초 뒤에야(마치 손을 뗀 시점과 무관하게) 결과가 나옴. Task 7의 4탭 실브라우저 검증에서도 같은 증상이 관측됐지만, 그때는 "서버 타이머 경합" 정도로 오판하고 넘어갔었음.

### 원인 분석

`TurnPanel.tsx`가 던지기 버튼을 `gaugePhase === "idle"`일 때만 렌더링하고, `gaugePhase === "charging"`일 때는 완전히 다른 `<p>` 엘리먼트("누르고 있는 중...")를 렌더링하도록 짜여 있었음. 그런데:

1. 플레이어가 버튼을 누르면 클라이언트가 `throwStart`를 보내고, 동시에 `e.currentTarget.setPointerCapture(e.pointerId)`로 포인터를 그 버튼에 캡처해둠.
2. 서버가 `gaugePhase`를 `"charging"`으로 바꾸고, 이 변경이 Colyseus의 기본 patch 주기(~50ms)로 클라이언트에 브로드캐스트됨.
3. `useMatchRoom.ts`의 `forceRender()`가 이 상태 변경으로 트리거되어 `TurnPanel`이 리렌더 → 조건이 `"idle"`에서 `"charging"`으로 바뀌면서 **버튼 엘리먼트 자체가 DOM에서 제거되고 `<p>`로 교체됨**.
4. 포인터 캡처를 가진 DOM 노드가 제거되면 브라우저가 그 캡처를 암묵적으로 해제한다 — 즉 플레이어가 아직 손가락/마우스 버튼을 누르고 있는 도중에, 캡처 대상 자체가 사라져버림.
5. 실제로 손을 뗄 때 `pointerup` 이벤트는 이미 사라진 버튼이 아니라 다른 곳으로 전달되고, `onPointerUp` 핸들러가 아예 호출되지 않음 → `throwRelease`가 서버로 전송되지 않음.
6. 결과적으로 약 50ms보다 긴 모든 실제 누르기는 서버의 5초 자동 던지기 타임아웃(무작위 결과)으로 대체됨 — REQUIREMENTS.md §5가 요구하는 "타이밍 실력이 결과에 반영되는" 핵심 메커니즘이 사실상 죽어 있었음.

증상을 처음 본 Task 7 검증(및 그걸 검토한 시점의 판단)은 이걸 "`throwStart`가 예약된 자동 던지기 타이머를 취소하지 않아서 생기는 서버 쪽 경합"으로 잘못 짚었음 — 코드만 읽고 그럴듯한 기존 설명에 패턴매칭한 것. 실제로 브라우저에서 여러 홀드 시간(0ms/600ms 등)으로 직접 눌러보고 "버튼이 뗄 때까지 DOM에 남아있는지"를 찍어봐서야 진짜 원인이 드러남.

### 해결

`gaugePhase === "idle"`과 `"charging"` 두 상태에서 **동일한 하나의 `<button>` 엘리먼트**를 유지하고(`isMyTurn && gaugePhase !== "resolved"`로 조건을 통일), 라벨 텍스트만 상태에 따라 바꿈. `onPointerDown` 핸들러는 `gaugePhase === "idle"`일 때만 실제로 동작하도록 가드(재입력 방지). `onPointerCancel`도 `onPointerUp`과 동일하게 처리(OS 제스처 인터럽트 등으로 캡처가 깨지는 경우의 안전망).

실제 브라우저(Playwright, 진짜 `pointerdown`→대기→`pointerup`)로 여러 홀드 시간(약 235/490/711/1014ms)을 재현해, 매번 손 뗀 시점 기준 50~83ms 안에 결과가 나오는 것을 확인(서버 자동 던지기의 3~5초 지연과 뚜렷이 구분됨).

### 교훈

증상이 "그럴듯한 기존 설명"과 맞아떨어져 보여도, 그 설명 자체를 실측으로 검증하지 않으면 잘못 짚을 수 있다. 이번엔 최종 전체 브랜치 리뷰(실제 앱을 띄워 직접 확인)가 아니었으면 그대로 넘어갈 뻔했음 — 다음부터는 타이밍 관련 버그는 코드 추론만으로 끝내지 말고 실제 홀드 시간 대 지연시간을 찍어서 확인할 것.

### 관련 파일
- `client/src/components/GameBoard.tsx` (2026-08-23 보드 시각화 개편으로 포인터 캡처 로직이 `TurnPanel.tsx`의 던지기 버튼에서 `GameBoard.tsx` 루트 `<div>`로 이동함 — 이 문서에 기록된 근본 원인/교훈은 그대로 유효, 위치만 옮겨졌다)

---

## #10 (위 #9 수정 중 발견) 세션ID에 하이픈이 들어있어 말 번호 추출이 깨짐

### 증상

#9를 고치면서 말 선택 버튼에 말 번호를 표시하도록 `pieceId.split("-")[1]`을 썼는데, 실제 브라우저에서 확인하니 `NaN`(`8KNaN8KNaN` 같은 문자열)이 표시됨.

### 원인 분석

`pieceId`는 `` `${sessionId}-${i}` `` 형태인데, Colyseus가 부여하는 `sessionId` 자체가 하이픈을 포함할 수 있음(실제 관측: `8KN-…`, `-_0n…`). `split("-")[1]`(두 번째 조각)은 `sessionId`의 첫 하이픈이 곧 "세션ID/말번호 경계"라고 가정하는데, 그 가정이 항상 참이 아니었음. 말 번호(`i`, 항상 `"0"` 또는 `"1"`, 절대 하이픈을 포함하지 않음)는 항상 문자열의 **마지막** 조각이라는 사실을 이용해야 했음.

### 해결

`pieceId.split("-")[1]` → `pieceId.split("-").pop()`으로 변경(하이픈을 몇 개 포함하든 마지막 조각이 항상 말 번호). `TurnPanel.tsx`와 `GameBoard.tsx` 양쪽 다 같은 패턴을 쓰고 있어서 둘 다 수정.

### 교훈

이런 종류의 버그는 타입체크로 절대 못 잡는다(`string.split(...)[1]`도 `.pop()`도 둘 다 타입상 유효한 `string | undefined`) — 실제 데이터(하이픈 포함 세션ID)로 브라우저에서 직접 확인해야만 드러남.

### 관련 파일
- `client/src/components/TurnPanel.tsx`
- `client/src/components/GameBoard.tsx`

---

## #11 캐릭터 2개 선택 후 하나를 취소하면 서버와 조용히 어긋남

### 증상

대기실에서 캐릭터 2개를 고른 뒤 그중 하나를 다시 눌러 취소하면, 화면엔 1개만 선택된 것처럼 보이지만 서버는 여전히 이전에 보낸 2개를 그대로 들고 있음 — 이 상태에서 "준비 완료"를 누르면 화면에 안 보이는 예전 캐릭터 조합으로 게임이 시작됨.

### 원인 분석

`WaitingRoom.tsx`의 `pickCharacters` 전송 로직이 "선택 개수가 정확히 2가 되는 순간"에만 서버로 메시지를 보내도록 되어 있었음. 그런데 토글 로직 자체는 이미 선택된 캐릭터를 다시 누르면 무조건 배열에서 빼도록(2→1) 허용하고 있었고, 이 경우엔 서버로 아무 메시지도 안 감 — "정확히 2일 때만 전송"이라는 규칙과 "2에서 1로 줄어드는 것도 허용"이라는 로직이 서로 안 맞았던 것.

### 해결

이미 2개가 선택된 상태에서 그중 하나를 다시 누르면 **아무 동작도 하지 않도록**(선택 취소 자체를 막음) 변경. 마음을 바꾸려면 기존에 있던 "세 번째 다른 캐릭터를 누르면 가장 오래된 선택이 밀려남" 로직을 쓰면 되고, 그 경로는 이미 정상적으로 서버와 동기화되어 있었음.

### 관련 파일
- `client/src/components/WaitingRoom.tsx`

---

## 참고: 실제로 문제가 아니었던 것 (오판 방지용 기록)

- **`throwStart`가 예약된 자동 던지기 타이머를 취소하지 않는 것** 자체는 버그가 아니라 REQUIREMENTS.md §4.1의 명시된 설계다 — "안 누르거나, 누르고 안 뗀 경우 둘 다" 5초 제한에 걸린다고 문서에 명시돼 있으므로, 제한시간이 임박한 시점에 누르기 시작해도 5초가 되면 서버가 대신 던지는 게 맞는 동작이다. 진짜 문제는 #9였고, 이건 그 증상을 잘못 짚은 최초 설명이었다.
- **보드 지름길 모델**(5/10/15번 코너 전부 "지름길 2칸=완주"로 단순화된 것)은 실제 윷놀이보다 스윙성이 크다는 지적이 있었지만, 사용자가 명시적으로 "지금은 보류, 클라이언트 렌더링 계획 시작 전에 재검토"로 결정했다 — 버그가 아니라 의도적으로 열어둔 설계 결정.
