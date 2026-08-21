# 1v1 모드(팀당 1명, 말 4개) 설계

> 기존 2v2(팀당 2명, 인당 말 2개) 방식은 그대로 유지하고, **팀당 1명이 말 4개를 전부 조종하는 1v1 모드를 대기실에서 명시적으로 선택**할 수 있게 한다. REQUIREMENTS.md v0.5로 갱신 대상.

## 1. 모드 선택 & 방 상태

- `MatchState`에 `mode: "2v2" | "1v1"` 필드 추가(문자열 타입, 기존 `phase`/`team`과 동일한 느슨한 문자열 관례). 기본값 `"2v2"`.
- 새 메시지 `pickMode { mode: "2v2" | "1v1" }` — `phase === "waiting"`일 때만 처리, 유효하지 않은 값이면 무시. **누구나 언제든(대기 단계 동안) 보낼 수 있다** — `pickTeam`/`pickCharacters`와 동일한 자유도. 실제 사용은 첫 입장자가 정하고 이후 입장자들이 그 값을 보고 맞추는 흐름이 되지만, 서버가 "누가 첫 입장자인지"를 별도로 추적하거나 권한을 제한하지는 않는다(기존 코드베이스에 그런 권한 개념 자체가 없음 — 새로 도입하지 않는다).
- **모드 전환 시 기존에 이미 고른 팀/캐릭터/준비 상태를 자동으로 초기화하지 않는다.** 모드가 바뀌면 그 값들이 새 모드의 조건(인원수, 캐릭터 개수)에 안 맞을 수 있는데, 이 경우 `maybeStartGame`이 조용히 시작을 보류하고 대기실 UI가 "왜 안 시작되는지"를 안내한다 — 기존에 이미 있는 패턴(캐릭터 미선택 등) 그대로 재사용, 새로운 리셋 로직을 만들지 않는다.
- **`maxClients`는 4로 그대로 둔다.** 방을 잠그는(`lock()`) 로직을 추가하지 않는다. 1v1 모드인데 3명 이상 들어와 있어도 방은 계속 그 인원을 받아들이되, 시작 조건(정확히 필요한 인원 + 팀 분배)이 맞을 때까지 `maybeStartGame`이 시작하지 않는다 — 남는 인원이 있으면 단지 게임이 시작되지 않을 뿐, 별도의 방 잠금/추방 처리는 하지 않는다(범위 밖).

## 2. 캐릭터 선택 — 모드에 따라 개수가 다르다

- **2v2**: 기존과 동일 — 정확히 서로 다른 2종. (기존 서버 코드는 실제로는 "서로 다름"을 검증하지 않고 클라이언트 UI의 토글 방식에만 의존하고 있었다 — 이번에 `pickCharacters` 핸들러를 모드 분기하면서, 2v2 한정으로 **서버 측에 명시적 중복 금지 검증을 추가**한다: `new Set(characters).size === characters.length`.)
- **1v1**: 정확히 4종, **중복 허용**(말 4개 중 같은 캐릭터를 여러 개 골라도 됨 — 예: 의사 2개 + 마담 2개). 서버는 개수(4)와 유효성(`VALID_CHARACTERS`)만 검사하고 중복 검증은 하지 않는다.
- 메시지 형식(`pickCharacters { characters: string[] }`)은 그대로, 서버가 `this.state.mode`를 보고 필요 개수/중복 허용 여부를 분기한다 — 클라이언트가 모드 정보를 별도로 실어 보낼 필요 없음.
- **능력 시스템(`abilities.ts`)은 변경 불필요.** 기존 로직이 이미 "한 팀에 같은 캐릭터가 여러 개 있을 수 있다"는 전제로 후보를 배열로 필터링해 순회하도록 짜여 있다(2026-08-21 캐릭터 능력 스펙에서 "두 팀원이 우연히 같은 2종을 고르는 경우"로 이미 다뤘던 케이스와 동일한 코드 경로) — 1v1에서 한 사람이 같은 캐릭터를 4개까지 골라도 그대로 동작한다.

## 3. 대기실 UI — 캐릭터 선택 화면 자체가 모드별로 다른 위젯

- 대기실 상단에 "2v2 / 1v1" 토글 버튼 2개 추가(팀 선택 버튼과 같은 스타일) → 클릭 시 `pickMode` 전송.
- **2v2일 때**: 기존과 동일한 캐릭터 토글 버튼 4개(교주/성직/마담/의사), 2개 고르면 자동 전송.
- **1v1일 때**: "말 1 / 말 2 / 말 3 / 말 4"라는 라벨이 붙은 `<select>` 드롭다운 4개(각각 4개 캐릭터 옵션, 기본값은 전부 `CHARACTERS[0]`인 "교주" — 유효한 값이라 그대로 둬도 시작 조건을 막지 않음). 넷 중 하나라도 바뀌면 현재 4개 값 전체를 `pickCharacters`로 전송(토글 방식과 달리 "2개 다 골라야 전송"이라는 중간 상태가 필요 없음 — 처음부터 4개 값이 항상 존재하므로).
- 참가자 목록/안내 문구("참가자 (X/4)", "A팀 2명/B팀 2명이 되어야...")를 모드에 맞춰 동적으로 바꾼다: 1v1이면 "참가자 (X/2)", "A팀 1명/B팀 1명이 되어야 게임이 시작됩니다", 캐릭터 완료 조건도 "모두 캐릭터를 4종씩 골라야"로.

## 4. 턴 순서 — `buildTurnOrder` 일반화

- 기존 시그니처 `buildTurnOrder(teamAIds: [string, string], teamBIds: [string, string]): string[]`을 `buildTurnOrder(teamAIds: string[], teamBIds: string[]): string[]`로 바꾼다.
- 동작은 동일한 규칙의 일반화: 두 배열 길이가 같다고 가정하고, `[A[0], B[0], A[1], B[1], ..., A[n-1], B[n-1]]` 순서로 번갈아 엮는다. 2v2(`n=2`)는 기존 `[A0,B0,A1,B1]`와 동일한 결과, 1v1(`n=1`)은 `[A0,B0]`.
- `nextTurnIndex`는 변경 없음(이미 `order: string[]`의 길이에만 의존하는 일반적인 구현).

## 5. 말 생성 — 모드별 말 개수

- `MatchRoom.maybeStartGame()`의 말 생성 루프에서 `for (let i = 0; i < 2; i++)`를 `piecesPerPlayer`(2v2=2, 1v1=4) 변수로 교체. 말 id 스킴(`${sessionId}-${i}`)과 캐릭터 배정(`owner.characters[i]`)은 그대로 — 인덱스 범위만 늘어난다.
- `maybeStartGame`의 시작 조건 전체를 모드 인식으로 재작성:
  - `requiredPerTeam = mode === "1v1" ? 1 : 2`
  - `requiredCharacters = mode === "1v1" ? 4 : 2`
  - 전체 진행 조건: 모든 플레이어가 `ready && characters.length === requiredCharacters`, 그리고 `teamA.length === requiredPerTeam && teamB.length === requiredPerTeam`, 그리고 `players.size === requiredPerTeam * 2`(팀 배정 안 된 여분 인원이 없어야 함 — 기존 `players.size !== 4` 가드의 일반화).

## 6. 승리 조건 — 매직넘버 제거

- `checkWinner(pieces, ownerId)`가 현재 `ownPieces.length === 2 && ownPieces.every(finished)`로 하드코딩되어 있다. 이걸 `ownPieces.length > 0 && ownPieces.every(finished)`로 바꾼다 — 말 개수(2 또는 4)에 무관하게 동작하도록 매직넘버 자체를 없앤다(모드별 분기가 필요 없어짐).

## 7. 데이터 모델 변경 요약

- `server/src/rooms/MatchState.ts`: `MatchState`에 `@type("string") mode: string = "2v2";` 추가.
- `server/src/rooms/MatchRoom.ts`: `pickMode` 메시지 핸들러 추가, `pickCharacters` 핸들러를 모드 분기, `maybeStartGame()` 전면 재작성(§5).
- `server/src/game/turns.ts`: `buildTurnOrder` 시그니처 일반화(§4), `checkWinner` 매직넘버 제거(§6).
- `client/src/game/matchTypes.ts`: `MatchState`에 `mode: "2v2" | "1v1"` 추가.
- `client/src/components/WaitingRoom.tsx`: 모드 토글 버튼, 1v1용 4-드롭다운 캐릭터 선택 위젯, 동적 안내 문구(§3).
- `client/src/components/TurnPanel.tsx`: **변경 불필요** — 이미 소유 말 전체를 `ownerSessionId` 기준으로 순회해 버튼을 그리므로 2개든 4개든 그대로 동작.

## 8. 문서(REQUIREMENTS.md) 반영

이 스펙 승인 후 REQUIREMENTS.md를 v0.5로 갱신(코드가 아니라 문서 작업이라 구현 계획의 태스크로 넣지 않고, 계획 실행 완료 후 컨트롤러가 직접 갱신 — 캐릭터 능력 스펙 때와 동일한 방식):
- §1(게임 구조 개요): "2팀 × 2인 = 총 4인 고정"을 "2v2(팀당 2인, 인당 말 2개) 또는 1v1(팀당 1인, 인당 말 4개) 중 대기실에서 선택"으로 갱신.
- §2(캐릭터 선택): 모드별 선택 개수(2v2=2종 서로 다름, 1v1=4종 중복 허용) 명시.
- §7(승리 조건): "팀 내 한 명이라도 자기 말 2개를 모두 완주"를 "자신이 조종하는 말을 전부 완주시킨 플레이어가 나오면 그 팀이 승리"로 일반화(1v1에서는 그 "한 명"이 유일한 팀원이 되므로 문구가 자연스럽게 커버됨).

## 9. 이번 범위에서 제외하는 것

- 방 잠금(`lock()`)이나 여분 인원 강제 퇴장 처리.
- 모드 전환 시 자동 리셋(팀/캐릭터/준비 상태 초기화).
- 1v1 전용 밸런스 조정(턴 제한시간, 능력 확률 등 — 전부 2v2와 동일하게 유지).
